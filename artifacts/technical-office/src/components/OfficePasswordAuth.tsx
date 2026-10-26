import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, FolderKanban, LoaderCircle, Plus } from "lucide-react";
import { Link, useLocation } from "wouter";
import {
  getListOfficeMembersQueryKey,
  useCreateOfficeMember,
  useListOfficeMembers,
  useResetOfficeMemberPassword,
} from "@workspace/api-client-react";
import type { OfficeMember } from "@workspace/api-client-react";

const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");
const apiPath = `${basePath}/api`;

type AuthState = "checking" | "signed-in" | "signed-out" | "failed";
type OfficePasswordAuthValue = {
  member: OfficeMember | null;
  state: AuthState;
  failure?: string;
  signIn: (username: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
};

class OfficeAuthError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

const OfficePasswordAuthContext = createContext<OfficePasswordAuthValue | null>(null);
const officeUsernamePattern = /^[a-zA-Z0-9._-]{3,32}$/;
const invalidOfficeUsernameMessage =
  "اسم المستخدم يجب أن يكون من 3 إلى 32 خانة، بلا مسافات. استخدم أحرفًا لاتينية أو أرقامًا أو نقطة أو شرطة.";

export function useOfficePasswordAuth(): OfficePasswordAuthValue {
  const context = useContext(OfficePasswordAuthContext);
  if (!context) throw new Error("OfficePasswordAuthProvider is missing.");
  return context;
}

async function readError(response: Response): Promise<string> {
  const data = (await response.json().catch(() => null)) as { error?: unknown } | null;
  return typeof data?.error === "string" ? data.error : "تعذّر إكمال الطلب.";
}

function officeMemberCreationError(error: unknown): string {
  const detail = (error as { data?: { error?: unknown } } | null)?.data?.error;
  let issues: unknown = detail;
  if (typeof detail === "string") {
    try {
      issues = JSON.parse(detail);
    } catch {
      if (/[\u0600-\u06ff]/i.test(detail)) return detail;
      if (detail === "Engineer name is required.") return "اكتب اسم المهندس.";
      issues = null;
    }
  }

  if (Array.isArray(issues)) {
    const fields = new Set(
      issues.map((issue) => {
        if (
          typeof issue === "object" &&
          issue !== null &&
          "path" in issue &&
          Array.isArray(issue.path)
        ) {
          return issue.path[0];
        }
        return undefined;
      }),
    );
    if (fields.has("username")) return invalidOfficeUsernameMessage;
    if (fields.has("password")) return "كلمة المرور المؤقتة يجب أن تكون 8 خانات على الأقل.";
    if (fields.has("name")) return "اكتب اسم المهندس.";
    if (fields.has("email")) return "راجع البريد الإلكتروني أو اتركه فارغًا.";
    return "راجع البيانات المدخلة، ثم حاول مرة أخرى.";
  }

  return "تعذّر إنشاء الحساب. تحقق من البيانات وحاول مرة أخرى.";
}

export function OfficePasswordAuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [member, setMember] = useState<OfficeMember | null>(null);
  const [state, setState] = useState<AuthState>("checking");
  const [failure, setFailure] = useState<string>();

  useEffect(() => {
    let active = true;
    fetch(`${apiPath}/auth/me`, {
      credentials: "same-origin",
      headers: { Accept: "application/json" },
    })
      .then(async (response) => {
        if (!active) return;
        if (response.status === 401) {
          setMember(null);
          setState("signed-out");
          return;
        }
        if (!response.ok) {
          throw new OfficeAuthError(await readError(response), response.status);
        }
        setMember((await response.json()) as OfficeMember);
        setState("signed-in");
      })
      .catch(() => {
        if (!active) return;
        setFailure("تعذّر التحقق من جلسة الدخول. تأكد من جاهزية خدمة التطبيق وقاعدة البيانات.");
        setState("failed");
      });
    return () => {
      active = false;
    };
  }, []);

  const signIn = useCallback(
    async (username: string, password: string) => {
      const response = await fetch(`${apiPath}/auth/login`, {
        method: "POST",
        credentials: "same-origin",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ username, password }),
      });
      if (!response.ok) {
        throw new OfficeAuthError(await readError(response), response.status);
      }
      const signedInMember = (await response.json()) as OfficeMember;
      queryClient.clear();
      setMember(signedInMember);
      setFailure(undefined);
      setState("signed-in");
    },
    [queryClient],
  );

  const signOut = useCallback(async () => {
    const response = await fetch(`${apiPath}/auth/logout`, {
      method: "POST",
      credentials: "same-origin",
    });
    if (!response.ok) {
      throw new OfficeAuthError(await readError(response), response.status);
    }
    queryClient.clear();
    setMember(null);
    setState("signed-out");
  }, [queryClient]);

  return (
    <OfficePasswordAuthContext.Provider
      value={{ member, state, failure, signIn, signOut }}
    >
      {children}
    </OfficePasswordAuthContext.Provider>
  );
}

export function PasswordSignInPage() {
  const { signIn, state, failure } = useOfficePasswordAuth();
  const [, setLocation] = useLocation();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setMessage("");
    setBusy(true);
    try {
      await signIn(username.trim(), password);
      setPassword("");
      setLocation("/dashboard", { replace: true });
    } catch (error) {
      const status = error instanceof OfficeAuthError ? error.status : 0;
      setMessage(
        status === 401
          ? "اسم المستخدم أو كلمة المرور غير صحيحة."
          : status === 429
            ? "محاولات كثيرة. انتظر 15 دقيقة ثم حاول مرة أخرى."
            : "تعذّر تسجيل الدخول. تأكد من بيانات الدخول وجاهزية الخدمة.",
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="landing-grid grid min-h-[100dvh] place-items-center px-4 py-10" dir="rtl">
      <section className="panel w-full max-w-md p-7 md:p-9">
        <div className="mb-8 flex justify-center">
          <div className="flex items-center gap-3">
            <span className="brand-mark"><FolderKanban size={20} /></span>
            <span className="text-lg font-extrabold text-[#203b39]">فريق المكتب الفنى</span>
          </div>
        </div>
        <div className="text-center">
          <h1 className="text-2xl font-extrabold text-[#203b39]">تسجيل الدخول</h1>
          <p className="mt-2 text-sm leading-7 text-[#71807a]">
            حسابات المهندسين ينشئها مدير المكتب.
          </p>
        </div>
        {state === "failed" && (
          <p className="mt-5 rounded-xl bg-[#f8e9df] p-3 text-sm text-[#8d4439]" role="alert">
            {failure}
          </p>
        )}
        <form onSubmit={submit} className="mt-7 space-y-4">
          <label className="block">
            <span className="field-label">اسم المستخدم</span>
            <input
              className="field"
              autoComplete="username"
              autoCapitalize="none"
              dir="ltr"
              required
              maxLength={254}
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              data-testid="input-office-username"
            />
          </label>
          <label className="block">
            <span className="field-label">كلمة المرور</span>
            <input
              className="field"
              type="password"
              autoComplete="current-password"
              required
              maxLength={256}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              data-testid="input-office-password"
            />
          </label>
          {message && <p className="text-sm font-semibold text-[#a64d40]" role="alert">{message}</p>}
          <button
            className="btn btn-primary w-full justify-center disabled:opacity-60"
            type="submit"
            disabled={busy || state === "checking"}
            data-testid="button-office-sign-in"
          >
            {busy || state === "checking" ? <LoaderCircle size={17} className="animate-spin" /> : null}
            دخول لمساحة المكتب
          </button>
        </form>
        <Link href="/" className="btn btn-soft mt-4 w-full justify-center">
          <ArrowLeft size={16} /> الصفحة الرئيسية
        </Link>
      </section>
    </main>
  );
}

export function PasswordTeamPage() {
  const client = useQueryClient();
  const { member: currentMember } = useOfficePasswordAuth();
  const members = useListOfficeMembers();
  const createMember = useCreateOfficeMember();
  const resetMemberPassword = useResetOfficeMemberPassword();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [username, setUsername] = useState("");
  const [usernameError, setUsernameError] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");
  const [isError, setIsError] = useState(false);
  const [resetTarget, setResetTarget] = useState<number | null>(null);
  const [newPassword, setNewPassword] = useState("");

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setMessage("");
    setIsError(false);
    setUsernameError("");
    const normalizedUsername = username.trim().toLowerCase();
    if (!officeUsernamePattern.test(normalizedUsername)) {
      setUsernameError(invalidOfficeUsernameMessage);
      return;
    }
    createMember.mutate(
      {
        data: {
          name: name.trim(),
          email: email.trim() || undefined,
          username: normalizedUsername,
          password,
        },
      },
      {
        onSuccess: (created) => {
          setName("");
          setEmail("");
          setUsername("");
          setPassword("");
          setMessage(`تم إنشاء حساب ${created.name} باسم المستخدم ${created.username}. أعطه كلمة المرور بشكل آمن.`);
          client.invalidateQueries({ queryKey: getListOfficeMembersQueryKey() });
        },
        onError: (error) => {
          setIsError(true);
          setMessage(officeMemberCreationError(error));
        },
      },
    );
  };

  const resetPassword = (event: FormEvent) => {
    event.preventDefault();
    if (resetTarget === null) return;
    const target = members.data?.find((entry) => entry.id === resetTarget);
    if (!target) return;
    resetMemberPassword.mutate(
      { memberId: resetTarget, data: { password: newPassword } },
      {
        onSuccess: () => {
          setNewPassword("");
          setResetTarget(null);
          setIsError(false);
          setMessage(
            resetTarget === currentMember?.id
              ? "تم تغيير كلمة مرورك. سجّل الدخول مرة أخرى بكلمة المرور الجديدة."
              : `تم تعيين كلمة مرور جديدة لـ ${target.name}. شاركها معه عبر قناة آمنة.`,
          );
          if (resetTarget === currentMember?.id) {
            window.setTimeout(() => window.location.assign(`${basePath}/sign-in`), 500);
          }
        },
        onError: (error) => {
          const details = (error as { data?: { error?: string } }).data?.error;
          setIsError(true);
          setMessage(details || "تعذّر تغيير كلمة المرور.");
        },
      },
    );
  };

  return (
    <main className="page-content">
      <div className="mb-6">
        <p className="text-xs font-bold text-[#d77850]">إدارة الوصول</p>
        <h1 className="mt-2 text-2xl font-extrabold text-[#304743]">فريق المكتب</h1>
        <p className="mt-2 text-sm text-[#87918b]">
          أنشئ حساب المهندس وشاركه اسم المستخدم وكلمة المرور. لن تُرسل دعوة بالبريد.
        </p>
      </div>
      <section className="panel p-5 md:p-7">
        <div className="mb-5">
          <h2 className="text-lg font-extrabold text-[#304743]">إضافة مهندس</h2>
          <p className="mt-1 text-sm text-[#87918b]">
            اكتب البريد فقط إذا كان للمهندس ملف قديم؛ سنربط الحساب به للحفاظ على تكليفاته السابقة.
          </p>
        </div>
        <form onSubmit={submit} className="grid gap-4 sm:grid-cols-2">
          <label className="block">
            <span className="field-label">اسم المهندس</span>
            <input className="field" required maxLength={120} value={name} onChange={(event) => setName(event.target.value)} />
          </label>
          <label className="block">
            <span className="field-label">اسم المستخدم</span>
            <input
              className="field"
              dir="ltr"
              autoCapitalize="none"
              required
              maxLength={32}
              value={username}
              aria-invalid={Boolean(usernameError)}
              aria-describedby={usernameError ? "office-username-help office-username-error" : "office-username-help"}
              onChange={(event) => {
                setUsername(event.target.value);
                setUsernameError("");
              }}
            />
            <span id="office-username-help" className="mt-1 block text-xs leading-5 text-[#87918b]">
              من 3 إلى 32 خانة. استخدم أحرفًا لاتينية أو أرقامًا أو نقطة أو شرطة، بلا مسافات. مثال: <bdi dir="ltr">zyad_hatem</bdi>
            </span>
            {usernameError && <span id="office-username-error" className="mt-1 block text-xs font-semibold text-[#a64d40]" role="alert">{usernameError}</span>}
          </label>
          <label className="block">
            <span className="field-label">كلمة المرور المؤقتة</span>
            <input className="field" type="password" autoComplete="new-password" required minLength={8} maxLength={256} value={password} onChange={(event) => setPassword(event.target.value)} />
          </label>
          <label className="block">
            <span className="field-label">بريد الملف القديم (اختياري)</span>
            <input className="field" type="email" dir="ltr" maxLength={254} value={email} onChange={(event) => setEmail(event.target.value)} />
          </label>
          <div className="sm:col-span-2">
            <button className="btn btn-primary disabled:opacity-50" type="submit" disabled={createMember.isPending} data-testid="button-create-office-member">
              {createMember.isPending ? <LoaderCircle size={16} className="animate-spin" /> : <Plus size={16} />}
              إنشاء الحساب
            </button>
            {message && <p className={`mt-3 text-sm font-semibold ${isError ? "text-[#a64d40]" : "text-[#386d60]"}`} role={isError ? "alert" : "status"}>{message}</p>}
          </div>
        </form>
      </section>
      <section className="panel mt-5 p-5 md:p-7">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h2 className="text-lg font-extrabold text-[#304743]">أعضاء المكتب</h2>
            <p className="mt-1 text-xs text-[#87918b]">حسابات المدير والمهندسين المسجلين.</p>
          </div>
          <span className="rounded-full bg-[#e9efe8] px-3 py-1 text-xs font-bold text-[#386d60]">{members.data?.length || 0}</span>
        </div>
        {members.isLoading ? (
          <p className="py-6 text-center text-sm text-[#87918b]">جارٍ تحميل الأعضاء…</p>
        ) : members.isError ? (
          <p className="py-6 text-center text-sm text-[#a64d40]">تعذّر تحميل الأعضاء.</p>
        ) : members.data?.length ? (
          <div className="divide-y divide-[#ece9df]">
            {members.data.map((member) => (
              <div key={member.id} className="border-b border-[#ece9df] last:border-b-0" data-testid={`row-office-member-${member.id}`}>
                <div className="flex items-center gap-3 py-3">
                  <span className="grid h-10 w-10 place-items-center rounded-xl bg-[#e4efeb] text-sm font-extrabold text-[#386d60]">
                    {(member.name || "م").trim().slice(0, 1)}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-bold text-[#304743]">{member.name}</p>
                    <p className="mt-1 truncate text-xs text-[#87918b]" dir="ltr">
                      {member.username || member.email || "—"}
                    </p>
                  </div>
                  <span className="badge">{member.role === "manager" ? "مدير المكتب" : "مهندس"}</span>
                  <button
                    type="button"
                    className="btn btn-soft px-3 py-2 text-xs"
                    onClick={() => {
                      setResetTarget(resetTarget === member.id ? null : member.id);
                      setNewPassword("");
                    }}
                    data-testid={`button-reset-password-${member.id}`}
                  >
                    تغيير كلمة المرور
                  </button>
                </div>
                {resetTarget === member.id && (
                  <form onSubmit={resetPassword} className="mb-4 flex flex-wrap items-end gap-3 rounded-xl bg-[#f8f7f1] p-3">
                    <label className="min-w-[220px] flex-1">
                      <span className="field-label">كلمة المرور الجديدة (12 حرفًا على الأقل)</span>
                      <input
                        className="field"
                        type="password"
                        autoComplete="new-password"
                        required
                        minLength={12}
                        maxLength={256}
                        value={newPassword}
                        onChange={(event) => setNewPassword(event.target.value)}
                      />
                    </label>
                    <button className="btn btn-primary disabled:opacity-50" type="submit" disabled={resetMemberPassword.isPending}>
                      {resetMemberPassword.isPending ? <LoaderCircle size={15} className="animate-spin" /> : null}
                      حفظ كلمة المرور
                    </button>
                  </form>
                )}
              </div>
            ))}
          </div>
        ) : (
          <p className="py-6 text-center text-sm text-[#87918b]">لسه مفيش أعضاء.</p>
        )}
      </section>
    </main>
  );
}

export { OfficeAuthError };
