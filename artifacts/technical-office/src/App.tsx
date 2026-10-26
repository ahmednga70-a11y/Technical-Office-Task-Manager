import { createContext, useContext, useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import { ClerkFailed, ClerkLoading, ClerkProvider, Show, SignIn, SignUp, useClerk, useUser } from '@clerk/react';
import { publishableKeyFromHost } from '@clerk/react/internal';
import { shadcn } from '@clerk/themes';
import {
  Activity, ArrowLeft, BriefcaseBusiness, CalendarDays, CheckCheck, CircleAlert,
  ClipboardList, Clock3, FolderKanban, LayoutDashboard, LogOut, MapPin, MessageCircle, Plus, Search,
  SlidersHorizontal, X, Pencil, Trash2, ListTodo, ArrowUpRight, LoaderCircle, RefreshCw,
} from 'lucide-react';
import { Link, Redirect, Route, Router as WouterRouter, Switch, useLocation, useParams } from 'wouter';
import {
  getGetOfficeDashboardQueryKey, getGetProjectQueryKey, getGetTaskDiscussionQueryKey, getListOfficeMembersQueryKey,
  getListOfficeNotificationsQueryKey,
  getListOfficeInvitationsQueryKey, getListProjectsQueryKey, getListTasksQueryKey,
  useCreateOfficeInvitation, useCreateProject, useCreateTask,
  useDeleteProject, useDeleteTask, useGetOfficeDashboard, useGetProject,
  useListOfficeInvitations, useListOfficeMembers, useListProjects, useListTasks,
  useRevokeOfficeInvitation, useSyncOfficeProfile,
  useUpdateProject, useUpdateTask,
} from '@workspace/api-client-react';
import type { OfficeInvitation, OfficeMember, Project, ProjectInput, Task, TaskInput, TaskUpdate } from '@workspace/api-client-react';
import TaskDiscussionDialog from '@/components/TaskDiscussionDialog';
import NotificationBell from '@/components/NotificationBell';
import AttachmentsPanel from '@/components/AttachmentsPanel';
import AuthStatus from '@/components/AuthStatus';
import {
  OfficePasswordAuthProvider,
  PasswordSignInPage,
  PasswordTeamPage,
  useOfficePasswordAuth,
} from '@/components/OfficePasswordAuth';
import { classifyOfficeAccessFailure, type OfficeAccessFailure } from '@/lib/office-access-failure';
import NotFound from '@/pages/not-found';
import '@/index.css';

const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: 20_000, retry: 1 } } });
const OfficeMemberContext = createContext<OfficeMember | null>(null);
type OfficeAccessState = 'checking' | 'member' | 'blocked' | 'signed-out';
const OfficeAccessContext = createContext<{ state: OfficeAccessState; failure?: OfficeAccessFailure }>({ state: 'checking' });
const basePath = import.meta.env.BASE_URL.replace(/\/$/, '');
const passwordAuthEnabled = import.meta.env.VITE_OFFICE_AUTH_MODE === 'password';
const externalClerk = import.meta.env.VITE_CLERK_AUTH_MODE === 'external';
const clerkPubKey = externalClerk
  ? import.meta.env.VITE_CLERK_PUBLISHABLE_KEY?.trim()
  : publishableKeyFromHost(window.location.hostname, import.meta.env.VITE_CLERK_PUBLISHABLE_KEY);
const clerkProxyUrl = externalClerk ? undefined : import.meta.env.VITE_CLERK_PROXY_URL;

const arabicStatus: Record<string, string> = {
  todo: 'لم تبدأ', in_progress: 'قيد التنفيذ', review: 'مراجعة', done: 'مكتملة',
  active: 'جاري', on_hold: 'متوقف مؤقتاً', completed: 'مكتمل',
};
const arabicCategory: Record<string, string> = {
  shop_drawing: 'رسومات تنفيذية', submittal: 'اعتماد مواد', rfi: 'استفسار فني',
  quantity_takeoff: 'حصر كميات', coordination: 'تنسيق', other: 'أخرى',
};
const arabicPriority: Record<string, string> = { low: 'منخفضة', medium: 'متوسطة', high: 'عالية', urgent: 'عاجلة' };
const statusTone: Record<string, string> = {
  todo: 'bg-[#f1eee5] text-[#696b5e]', in_progress: 'bg-[#e0efec] text-[#286960]',
  review: 'bg-[#fbeddc] text-[#9d6029]', done: 'bg-[#e6f1e2] text-[#4c7446]',
  active: 'bg-[#e0efec] text-[#286960]', on_hold: 'bg-[#fbeddc] text-[#9d6029]',
  completed: 'bg-[#e6f1e2] text-[#4c7446]',
};
const priorityTone: Record<string, string> = {
  low: 'bg-[#f1eee5] text-[#727263]', medium: 'bg-[#e5eef1] text-[#52717a]',
  high: 'bg-[#fbeddc] text-[#9d6029]', urgent: 'bg-[#f8e5df] text-[#aa4c3d]',
};
const fmtDate = (date?: string | null) => {
  if (!date) return '—';
  const parsed = new Date(date);
  return Number.isNaN(parsed.getTime()) ? date : new Intl.DateTimeFormat('ar-EG', { day: 'numeric', month: 'short' }).format(parsed);
};
const initials = (name?: string | null) => (name || 'م').trim().split(/\s+/).slice(0, 2).map((part) => part[0]).join('');

function stripBase(path: string) {
  return basePath && path.startsWith(basePath) ? path.slice(basePath.length) || '/' : path;
}

const clerkAppearance = {
  theme: shadcn,
  cssLayerName: 'clerk',
  options: { logoPlacement: 'inside' as const, logoLinkUrl: basePath || '/', logoImageUrl: `${window.location.origin}${basePath}/logo.svg` },
  variables: {
    colorPrimary: '#285e59', colorForeground: '#203b39', colorMutedForeground: '#71807a',
    colorDanger: '#a64d40', colorBackground: '#fbfaf5', colorInput: '#f8f6ef',
    colorInputForeground: '#203b39', colorNeutral: '#d9d6ca', fontFamily: "'Noto Sans Arabic', sans-serif",
    borderRadius: '0.8rem',
  },
  elements: {
    rootBox: 'w-full flex justify-center',
    cardBox: 'bg-[#fbfaf5] rounded-2xl w-[440px] max-w-full overflow-hidden border border-[#dedbcf]',
    card: '!shadow-none !border-0 !bg-transparent !rounded-none',
    footer: '!shadow-none !border-0 !bg-transparent !rounded-none',
    headerTitle: 'text-[#203b39] font-bold', headerSubtitle: 'text-[#71807a]',
    socialButtonsBlockButtonText: 'text-[#203b39] font-semibold', formFieldLabel: 'text-[#203b39] font-semibold',
    footerActionLink: 'text-[#285e59] font-bold', footerActionText: 'text-[#71807a]',
    dividerText: 'text-[#71807a]', identityPreviewEditButton: 'text-[#285e59]',
    formFieldSuccessText: 'text-[#286960]', alertText: 'text-[#a64d40]',
    logoBox: 'rounded-xl', logoImage: 'object-contain', socialButtonsBlockButton: 'border-[#d9d6ca] rounded-xl',
    formButtonPrimary: 'bg-[#285e59] hover:bg-[#1e514d] rounded-xl',
    formFieldInput: 'bg-[#f8f6ef] border-[#d9d6ca] rounded-xl text-[#203b39]',
    footerAction: 'border-t border-[#e6e2d7]', dividerLine: 'bg-[#e6e2d7]', alert: 'rounded-xl',
    otpCodeFieldInput: 'border-[#d9d6ca] rounded-lg', formFieldRow: 'gap-2', main: 'gap-4',
  },
};

function Brand({ inverse = false }: { inverse?: boolean }) {
  return <div className="flex items-center gap-3" dir="rtl">
    <span className="brand-mark"><FolderKanban size={20} strokeWidth={2.2} /></span>
    <span className={`brand-word text-[17px] font-extrabold tracking-tight ${inverse ? 'text-white' : 'text-[#203b39]'}`}>فريق المكتب الفنى</span>
  </div>;
}

function ClerkQueryClientCacheInvalidator() {
  const { addListener } = useClerk();
  const client = useQueryClient();
  useEffect(() => {
    let previous: string | null | undefined;
    return addListener(({ user }) => {
      const current = user?.id ?? null;
      if (previous !== undefined && previous !== current) client.clear();
      previous = current;
    });
  }, [addListener, client]);
  return null;
}

function ProfileSync({children}:{children:ReactNode}) {
  const { user, isLoaded, isSignedIn } = useUser();
  const sync = useSyncOfficeProfile();
  const client = useQueryClient();
  const [access,setAccess]=useState<{ state: OfficeAccessState; failure?: OfficeAccessFailure }>({ state: 'checking' });
  const primaryEmail = user?.primaryEmailAddress?.emailAddress;
  const primaryVerification = user?.primaryEmailAddress?.verification.status;
  useEffect(() => {
    let active = true;
    if (!isLoaded) { setAccess({ state: 'checking' }); return; }
    if (!isSignedIn || !user) { setAccess({ state: 'signed-out' }); return; }
    const email = user.primaryEmailAddress?.emailAddress || user.emailAddresses[0]?.emailAddress || '';
    if (!email) { setAccess({ state: 'blocked', failure: classifyOfficeAccessFailure({ status: 403 }) }); return; }
    setAccess({ state: 'checking' });
    sync.mutate({ data: { name: user.fullName || user.firstName || email.split('@')[0], email } }, {
      onSuccess: () => {
        if (!active) return;
        setAccess({ state: 'member' });
        client.invalidateQueries({ queryKey: getListOfficeMembersQueryKey() });
      },
      onError: error => {
        if (active) setAccess({ state: 'blocked', failure: classifyOfficeAccessFailure(error) });
      },
    });
    return () => { active = false; };
  }, [isLoaded, isSignedIn, user?.id, primaryEmail, primaryVerification]);
  return <OfficeAccessContext.Provider value={access}>{children}</OfficeAccessContext.Provider>;
}

function SignInPage() {
  return <div className="min-h-[100dvh] grid place-items-center px-4 py-10 landing-grid">
    <div className="absolute top-7 right-8"><Link href="/" className="no-underline"><Brand /></Link></div>
    <SignIn routing="path" path={`${basePath}/sign-in`} signUpUrl={`${basePath}/sign-up`} />
  </div>;
}
function SignUpPage() {
  return <div className="min-h-[100dvh] grid place-items-center px-4 py-10 landing-grid">
    <div className="absolute top-7 right-8"><Link href="/" className="no-underline"><Brand /></Link></div>
    <SignUp routing="path" path={`${basePath}/sign-up`} signInUrl={`${basePath}/sign-in`} />
  </div>;
}

function HomePage() {
  const entryPath = passwordAuthEnabled ? '/sign-in' : '/sign-up';
  const entryLabel = passwordAuthEnabled ? 'دخول المهندسين' : 'ابدأ مساحة العمل';
  return <main className="min-h-[100dvh] overflow-hidden bg-[#f7f5ed]" dir="rtl">
    <header className="mx-auto flex max-w-[1320px] items-center justify-between px-6 py-6 md:px-10">
      <Brand />
      <nav className="hidden items-center gap-8 text-sm font-semibold text-[#61716d] md:flex">
        <a href="#method" className="no-underline text-inherit hover:text-[#285e59]">طريقة العمل</a>
        <a href="#focus" className="no-underline text-inherit hover:text-[#285e59]">للمكتب الفني</a>
      </nav>
      <div className="flex gap-2">
        <Link href="/sign-in" className="btn btn-ghost">دخول</Link>
        {!passwordAuthEnabled&&<Link href={entryPath} className="btn btn-primary">{entryLabel} <ArrowLeft size={16} /></Link>}
      </div>
    </header>
    <section className="landing-grid relative mx-auto grid min-h-[610px] max-w-[1320px] grid-cols-1 items-center gap-12 px-6 pb-16 pt-10 md:grid-cols-[1.08fr_.92fr] md:px-10 md:pb-24">
      <div className="relative z-10">
        <div className="mb-7 inline-flex items-center gap-2 rounded-full border border-[#d8d9cc] bg-[#fbfaf4] px-4 py-2 text-[12px] font-bold text-[#51716b]">
          <span className="h-2 w-2 rounded-full bg-[#e17f56]" /> مساحة واحدة لكل شغل المكتب الفني
        </div>
        <h1 className="max-w-[740px] text-[clamp(46px,7vw,88px)] font-extrabold leading-[1.16] tracking-[-.06em] text-[#203b39]">
          الشغل واضح،<br /><span className="text-[#d77850]">والتسليم في معاده.</span>
        </h1>
        <p className="mt-6 max-w-[600px] text-lg leading-[2] text-[#687773]">
          فريق المكتب الفنى يجمع المشاريع والمهام والمسؤوليات في مكان واحد. عشان كل مهندس يعرف عليه إيه، والمدير يشوف الصورة كاملة من غير رسائل متفرقة.
        </p>
        <div className="mt-9 flex flex-wrap items-center gap-4">
          <Link href={entryPath} className="btn btn-primary px-6 py-4 text-base">{passwordAuthEnabled?'دخول المهندسين':'أنشئ مساحة مكتبك'} <ArrowLeft size={18} /></Link>
          <span className="text-xs font-semibold text-[#84908a]">مصمم لشغل الفرق الهندسية اليومية</span>
        </div>
        <div className="mt-14 flex items-center gap-8 border-t border-[#dcdace] pt-6">
          <div><strong className="block font-mono text-2xl text-[#285e59]">01</strong><span className="text-xs text-[#77827c]">كل مشروع له صورة واضحة</span></div>
          <div className="h-9 w-px bg-[#dcdace]" />
          <div><strong className="block font-mono text-2xl text-[#285e59]">02</strong><span className="text-xs text-[#77827c]">كل مهمة لها مسؤول وموعد</span></div>
        </div>
      </div>
      <div className="relative mx-auto w-full max-w-[550px]">
        <div className="absolute -left-4 top-10 hidden h-[390px] w-[70px] rounded-2xl bg-[#e5e2d6] md:block" />
        <div className="relative rounded-[26px] border border-[#d9d8cb] bg-[#fbfaf5] p-4 shadow-[0_32px_80px_rgba(36,66,60,.14)] md:rotate-[-2deg]">
          <div className="flex items-center justify-between border-b border-[#e7e4d9] px-3 pb-4">
            <span className="text-xs font-bold text-[#6e7c77]">نظرة عامة على المكتب</span>
            <span className="flex items-center gap-2 text-[10px] text-[#89928b]"><span className="h-2 w-2 rounded-full bg-[#739f82]" /> محدّث الآن</span>
          </div>
          <div className="grid grid-cols-3 gap-3 py-4">
            {[['مشاريع جارية','08','teal'],['مهام مفتوحة','34','sand'],['تسليمات قريبة','06','peach']].map(([label,number,tone])=><div className={`rounded-2xl p-4 ${tone==='peach'?'bg-[#f8e9df]':tone==='sand'?'bg-[#efeee4]':'bg-[#e4efeb]'}`} key={label}><p className="text-[10px] font-semibold text-[#74817b]">{label}</p><strong className="mt-2 block font-mono text-[27px] text-[#203b39]">{number}</strong></div>)}
          </div>
          <div className="rounded-2xl bg-[#f2f0e7] p-4">
            <div className="mb-4 flex items-center justify-between"><strong className="text-sm text-[#203b39]">المهام القادمة</strong><span className="text-[10px] text-[#88918a]">هذا الأسبوع</span></div>
            {[['اعتماد مخطط التكييف','مبنى النخيل','عاجلة','27 أكتوبر'],['مراجعة حصر الكميات','مركز الأعمال','قيد التنفيذ','29 أكتوبر'],['تجهيز استفسار الموقع','برج الميناء','مراجعة','31 أكتوبر']].map((row,i)=><div className="flex items-center gap-3 border-t border-[#dfded3] py-3" key={row[0]}><span className={`grid h-8 w-8 place-items-center rounded-xl text-xs font-bold ${i===0?'bg-[#f5ddd2] text-[#b35b3d]':'bg-[#e1ece6] text-[#477b6e]'}`}>{String(i+1).padStart(2,'0')}</span><div className="min-w-0 flex-1"><p className="truncate text-xs font-bold text-[#314946]">{row[0]}</p><p className="mt-1 text-[10px] text-[#87908a]">{row[1]}</p></div><span className="text-[10px] text-[#77817b]">{row[3]}</span></div>)}
          </div>
          <div className="absolute -right-6 top-[44%] hidden rounded-2xl border border-[#e4dfd3] bg-white px-4 py-3 shadow-xl md:block"><span className="flex items-center gap-2 text-xs font-bold text-[#335d56]"><CheckCheck size={16} className="text-[#548875]" /> كل مسؤولية في مكانها</span></div>
        </div>
        <div className="hero-stamp absolute -right-5 -top-5 hidden rounded-full bg-[#285e59] px-3 py-4 text-[10px] font-bold tracking-widest text-[#f5f0e4] md:block">إدارة هندسية • بوضوح</div>
      </div>
    </section>
    <section id="method" className="bg-[#203b39] py-20 text-[#f7f4e9]">
      <div className="mx-auto max-w-[1320px] px-6 md:px-10">
        <div className="grid gap-10 md:grid-cols-[.8fr_1.2fr]">
          <div><span className="text-xs font-bold tracking-widest text-[#e18a62]">من أول التكليف لحد التسليم</span><h2 className="mt-5 text-4xl font-extrabold leading-[1.5] tracking-tight md:text-5xl">بدل ما تسأل<br />«وصلنا لفين؟»</h2></div>
          <div className="grid gap-8 border-t border-white/15 pt-8 md:grid-cols-3 md:border-t-0 md:pt-0">
            {[['01','لمحة واحدة','حالة المشاريع والمهام المتأخرة والقادمة قدامك أول ما تفتح المساحة.'],['02','مسؤول واضح','كل مهمة مربوطة بمشروع، ومهندس، وتاريخ تسليم مفهوم.'],['03','تحديث مستمر','غيّر الحالة في لحظتها وخلي الفريق كله شايف نفس الصورة.']].map(([n,title,desc])=><article className="border-t border-white/15 pt-5" key={n}><span className="font-mono text-sm text-[#e18a62]">{n}</span><h3 className="mt-5 text-lg font-bold">{title}</h3><p className="mt-3 text-sm leading-7 text-[#b7c4bd]">{desc}</p></article>)}
          </div>
        </div>
      </div>
    </section>
    <section id="focus" className="mx-auto grid max-w-[1320px] gap-12 px-6 py-20 md:grid-cols-2 md:items-center md:px-10 md:py-28">
      <div className="relative overflow-hidden rounded-[26px] bg-[#e9e5d8] p-8 md:p-12">
        <div className="absolute -left-12 -top-12 h-48 w-48 rounded-full border-[1px] border-[#c8c9b9]" /><div className="absolute -left-5 -top-5 h-32 w-32 rounded-full border-[1px] border-[#c8c9b9]" />
        <p className="text-xs font-bold tracking-wide text-[#56746d]">أدوات المكتب الفني، مش أدوات عامة</p>
        <div className="mt-8 grid grid-cols-2 gap-3">
          {['رسومات تنفيذية','اعتمادات مواد','استفسارات فنية','حصر كميات','تنسيق مواقع','ومهام أخرى'].map((x,i)=><div className="flex items-center gap-3 rounded-xl border border-[#d8d7ca] bg-[#f7f5ed]/80 p-3 text-sm font-bold text-[#425c56]" key={x}><span className="font-mono text-[10px] text-[#dc7c54]">0{i+1}</span>{x}</div>)}
        </div>
      </div>
      <div><span className="text-xs font-bold tracking-widest text-[#d77850]">مبني على واقع شغلك</span><h2 className="mt-5 text-4xl font-extrabold leading-[1.5] tracking-tight text-[#203b39] md:text-5xl">مساحة تعرف لغة المشروع.</h2><p className="mt-5 text-base leading-8 text-[#6d7a74]">من الرسومات التنفيذية والـ RFI لحد حصر الكميات والتنسيق، رتّب شغل الفريق بنفس التصنيفات اللي بتستخدموها كل يوم.</p><Link href={entryPath} className="mt-8 inline-flex items-center gap-2 font-bold text-[#285e59] no-underline">{passwordAuthEnabled?'دخول المهندسين':'ابدأ بتنظيم شغلك'} <ArrowLeft size={17} /></Link></div>
    </section>
    <footer className="border-t border-[#dedbcf] bg-[#f0eee5]"><div className="mx-auto flex max-w-[1320px] flex-col gap-5 px-6 py-8 md:flex-row md:items-center md:justify-between md:px-10"><Brand /><span className="text-xs text-[#77827c]">فريق المكتب الفنى — مساحة شغل أوضح للمكاتب الفنية.</span><Link href="/sign-in" className="text-sm font-bold text-[#285e59] no-underline">دخول لمساحة العمل <ArrowLeft size={15} className="inline" /></Link></div></footer>
  </main>;
}

function NavShell({ children }: { children: ReactNode }) {
  return passwordAuthEnabled
    ? <PasswordNavShell>{children}</PasswordNavShell>
    : <ClerkNavShell>{children}</ClerkNavShell>;
}

function ClerkNavShell({ children }: { children: ReactNode }) {
  const { user } = useUser();
  const { signOut } = useClerk();
  const { data: members } = useListOfficeMembers();
  const member = members?.find((entry) => entry.clerkUserId === user?.id) ?? null;
  return <OfficeShell
    member={member}
    name={user?.fullName || user?.firstName || 'عضو الفريق'}
    onSignOut={() => signOut({ redirectUrl: basePath || '/' })}
  >{children}</OfficeShell>;
}

function PasswordNavShell({ children }: { children: ReactNode }) {
  const { member, signOut } = useOfficePasswordAuth();
  return <OfficeShell
    member={member}
    name={member?.name || 'عضو الفريق'}
    onSignOut={() => signOut().catch(() => window.alert('تعذّر تسجيل الخروج. تحقق من الاتصال ثم حاول مرة أخرى.'))}
  >{children}</OfficeShell>;
}

function OfficeShell({
  children,
  member,
  name,
  onSignOut,
}: {
  children: ReactNode;
  member: OfficeMember | null;
  name: string;
  onSignOut: () => void | Promise<unknown>;
}) {
  const [location] = useLocation();
  const nav = [
    { href: '/dashboard', label: 'لوحة المتابعة', icon: LayoutDashboard },
    { href: '/projects', label: 'المشاريع', icon: BriefcaseBusiness },
    { href: '/tasks', label: 'المهام', icon: ClipboardList },
    ...(member?.role === 'manager' ? [{ href: '/team', label: 'الفريق', icon: Activity }] : []),
  ];
  return <OfficeMemberContext.Provider value={member}><div className="app-shell" dir="rtl">
    <aside className="sidebar">
      <div className="brand-block mb-12 px-2"><Brand inverse /></div>
      <p className="side-caption mb-3 px-3 text-[10px] font-bold tracking-[.18em] text-[#9cafaa]">مساحة المكتب</p>
      <nav className="flex flex-col gap-1">
        {nav.map(({href,label,icon:Icon})=><Link key={href} href={href} className={`nav-link ${location===href || (href==='/projects'&&location.startsWith('/projects/'))?'active':''}`} aria-current={location===href || (href==='/projects'&&location.startsWith('/projects/'))?'page':undefined} data-testid={`link-nav-${href.slice(1)}`}><Icon size={18}/><span className="nav-label">{label}</span></Link>)}
      </nav>
      <div className="mt-auto">
        <div className="profile-block mb-3 flex items-center gap-3 rounded-2xl border border-white/10 bg-white/[.04] p-3">
          <div className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-[#d97753] text-xs font-extrabold text-white">{initials(name)}</div>
          <div className="profile-copy min-w-0"><p className="truncate text-xs font-bold text-white">{name}</p><p className="mt-1 text-[10px] text-[#a9bbb5]">{member ? member.role === 'manager' ? 'مدير المكتب الفني' : 'مهندس المكتب الفني' : 'عضو الفريق'}</p></div>
        </div>
        <button className="nav-link w-full" onClick={onSignOut} data-testid="button-sign-out"><LogOut size={18}/><span className="nav-label">تسجيل الخروج</span></button>
      </div>
    </aside>
    <div className="main-area">
      <header className="topbar">
         <div className="flex items-center gap-2 text-xs text-[#87918b]"><span className="text-[#365e58]">مساحة العمل</span><span>/</span><span className="text-[#4f625d]">{location.startsWith('/projects')?'المشاريع':location==='/tasks'?'المهام':location==='/team'?'الفريق':'لوحة المتابعة'}</span></div>
        <div className="flex items-center gap-3">
          <span className="hidden text-xs text-[#77827c] sm:block">{new Intl.DateTimeFormat('ar-EG',{weekday:'long',day:'numeric',month:'long'}).format(new Date())}</span>
          <NotificationBell />
          <button className="mobile-sign-out" onClick={onSignOut} data-testid="button-mobile-sign-out"><LogOut size={16}/><span>خروج</span></button>
        </div>
      </header>
      {children}
    </div>
  </div></OfficeMemberContext.Provider>;
}

function PageTitle({ eyebrow, title, description, action }: { eyebrow?: string; title: string; description?: string; action?: ReactNode }) {
  return <div className="mb-8 flex flex-wrap items-end justify-between gap-4"><div>{eyebrow&&<p className="mb-2 text-[11px] font-bold tracking-[.12em] text-[#d77850]">{eyebrow}</p>}<h1 className="text-[30px] font-extrabold tracking-tight text-[#203b39] md:text-[36px]" data-testid="text-page-title">{title}</h1>{description&&<p className="mt-2 text-sm text-[#77827c]">{description}</p>}</div>{action}</div>;
}
function ErrorState({ retry }: { retry: () => void }) {
  return <div className="panel flex flex-col items-center p-10 text-center"><CircleAlert size={28} className="text-[#bd6751]"/><h3 className="mt-4 font-bold">مش قادرين نحمّل البيانات دلوقتي</h3><p className="mt-2 text-sm text-[#77827c]">جرّب تاني بعد لحظة، ولو المشكلة مستمرة راجع اتصالك.</p><button className="btn btn-soft mt-5" onClick={retry}><RefreshCw size={15}/> إعادة المحاولة</button></div>;
}
function SkeletonRows({ count=4 }: { count?: number }) {
  return <div className="space-y-3">{Array.from({length:count},(_,i)=><div className="panel flex items-center gap-4 p-4" key={i}><div className="skeleton h-10 w-10"/><div className="flex-1"><div className="skeleton mb-2 h-3 w-1/3"/><div className="skeleton h-2.5 w-1/2"/></div><div className="skeleton h-7 w-20"/></div>)}</div>;
}
function EmptyState({ title, body, action }: { title: string; body: string; action?: ReactNode }) {
  return <div className="panel flex flex-col items-center px-6 py-14 text-center"><span className="grid h-14 w-14 place-items-center rounded-2xl bg-[#e7efeb] text-[#3d7569]"><FolderKanban size={24}/></span><h3 className="mt-5 font-bold text-[#304743]">{title}</h3><p className="mt-2 max-w-sm text-sm leading-7 text-[#78837d]">{body}</p>{action&&<div className="mt-5">{action}</div>}</div>;
}
function StatusBadge({ status }: { status: string }) {
  return <span className={`badge ${statusTone[status] || 'bg-[#f1eee5] text-[#696b5e]'}`} data-testid={`status-badge-${status}`}>{arabicStatus[status] || status}</span>;
}
function TaskRow({ task, onEdit, onDelete, onDiscussion }: { task: Task; onEdit?: (task: Task) => void; onDelete?: (task: Task) => void; onDiscussion?: (task: Task) => void }) {
  const member=useContext(OfficeMemberContext);
  const canEdit=member?.role==='manager'||task.assigneeId===member?.id;
  const canDelete=member?.role==='manager';
  const canDiscuss=member?.role==='manager'||task.assigneeId===member?.id;
  return <div className="table-row grid grid-cols-[minmax(0,1.5fr)_minmax(110px,.8fr)_minmax(90px,.6fr)_minmax(86px,.55fr)_auto] items-center gap-4 py-4 max-md:grid-cols-[minmax(0,1fr)_auto] max-md:gap-y-3" data-testid={`row-task-${task.id}`}>
    <div className="min-w-0"><div className="flex items-center gap-2"><h3 className="truncate text-sm font-bold text-[#304743]">{task.title}</h3>{task.priority==='urgent'&&<CircleAlert size={14} className="shrink-0 text-[#c05a45]"/>}</div><p className="mt-1 truncate text-xs text-[#8a938c]">{task.projectName} <span className="mx-1">·</span>{arabicCategory[task.category]||task.category}</p></div>
    <div className="hidden items-center gap-2 text-xs text-[#6e7a74] md:flex"><span className="grid h-7 w-7 place-items-center rounded-full bg-[#e8ebe2] text-[10px] font-bold text-[#4b665d]">{initials(task.assigneeName)}</span>{task.assigneeName||'غير معيّنة'}</div>
    <div className="hidden md:block"><StatusBadge status={task.status}/></div>
    <span className={`hidden text-xs font-semibold md:block ${new Date(task.dueDate)<new Date()&&task.status!=='done'?'text-[#bd5d49]':'text-[#77827c]'}`}><CalendarDays size={13} className="ml-1 inline"/>{fmtDate(task.dueDate)}</span>
    <div className="flex justify-end gap-1">{onDiscussion&&canDiscuss&&<button type="button" className="btn btn-ghost !p-2" title="نقاش وسجل المهمة" aria-label={`فتح نقاش المهمة ${task.title}`} onClick={()=>onDiscussion(task)} data-testid={`button-discussion-task-${task.id}`}><MessageCircle size={15}/></button>}{onEdit&&canEdit&&<button className="btn btn-ghost !p-2" title="تعديل المهمة" onClick={()=>onEdit(task)} data-testid={`button-edit-task-${task.id}`}><Pencil size={15}/></button>}{onDelete&&canDelete&&<button className="btn btn-ghost !p-2 hover:text-[#b84c40]" title="حذف المهمة" onClick={()=>onDelete(task)} data-testid={`button-delete-task-${task.id}`}><Trash2 size={15}/></button>}</div>
    <div className="col-span-2 flex items-center gap-2 md:hidden"><StatusBadge status={task.status}/><span className="text-[11px] text-[#77827c]">{task.assigneeName||'غير معيّنة'} · {fmtDate(task.dueDate)}</span></div>
  </div>;
}

function DashboardPage() {
  const { data, isLoading, isError, refetch } = useGetOfficeDashboard();
  const projects = useListProjects();
  const taskQuery = useListTasks();
  const member = useContext(OfficeMemberContext);
  if (isLoading) return <main className="page-content"><div className="skeleton mb-8 h-10 w-64"/><div className="panel mb-6 p-5"><div className="skeleton mb-4 h-5 w-40"/><SkeletonRows count={2}/></div><div className="grid grid-cols-2 gap-4 md:grid-cols-4">{[1,2,3,4].map(x=><div className="panel p-5" key={x}><div className="skeleton h-3 w-1/2"/><div className="skeleton mt-5 h-8 w-1/3"/></div>)}</div><div className="mt-7"><SkeletonRows/></div></main>;
  if (isError||!data) return <main className="page-content"><ErrorState retry={()=>refetch()}/></main>;
  const allTasks = [...new Map<number, Task>([...(taskQuery.data || []), ...(data.upcomingTasks || []), ...(data.recentTasks || [])].map(task => [task.id, task] as const)).values()];
  const cairoDateParts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Cairo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date()).map(part => [part.type, part.value]));
  const today = `${cairoDateParts.year}-${cairoDateParts.month}-${cairoDateParts.day}`;
  const weekEndDate = new Date(`${today}T00:00:00.000Z`);
  weekEndDate.setUTCDate(weekEndDate.getUTCDate() + 7);
  const weekEnd = weekEndDate.toISOString().slice(0, 10);
  const dateKey = (value: Task['dueDate']) => new Date(value).toISOString().slice(0, 10);
  const openTasks = allTasks.filter(task => task.status !== 'done');
  const overdueTasks = openTasks.filter(task => dateKey(task.dueDate) < today).sort((a,b)=>a.dueDate.localeCompare(b.dueDate));
  const overdueIds = new Set(overdueTasks.map(task=>task.id));
  const dueSoonTasks = openTasks.filter(task => { const due = dateKey(task.dueDate); return !overdueIds.has(task.id) && due >= today && due <= weekEnd; }).sort((a,b)=>a.dueDate.localeCompare(b.dueDate));
  const priorityIds = new Set([...overdueTasks,...dueSoonTasks].map(task=>task.id));
  const unassignedTasks = member?.role === 'manager' ? openTasks.filter(task=>task.assigneeId===null&&!priorityIds.has(task.id)).sort((a,b)=>a.dueDate.localeCompare(b.dueDate)) : [];
  const breakdown = ['todo','in_progress','review','done'].map((status)=>({status,count:data.statusBreakdown?.find((x)=>x.status===status)?.count||0}));
  const cards = [
    { label:'مشاريع نشطة', value:data.activeProjectCount, icon:BriefcaseBusiness, color:'#e2efea', accent:'#39736a' },
    { label:'إجمالي المهام', value:data.taskCount, icon:ListTodo, color:'#f0eee2', accent:'#947a46' },
    { label:'مهام مكتملة', value:data.completedTaskCount, icon:CheckCheck, color:'#e8eee0', accent:'#5d7c54' },
    { label:'متأخرة', value:data.overdueTaskCount, icon:Clock3, color:'#f7e8df', accent:'#bd654b' },
  ];
  return <main className="page-content">
    <PageTitle eyebrow="صباح الشغل المرتّب" title="لوحة المتابعة" description="ملخص سريع للمشاريع والمهام اللي محتاجة عينك." action={<Link href="/tasks" className="btn btn-primary"><ClipboardList size={17}/> عرض المهام</Link>}/>
    <section className="attention-panel mb-6" aria-labelledby="attention-title">
      <div className="attention-heading"><div><p className="attention-kicker">الأولوية الآن</p><h2 id="attention-title">ما يحتاج متابعة</h2></div><span className="attention-total">{data.overdueTaskCount + data.dueSoonTaskCount + (member?.role === 'manager' ? unassignedTasks.length : 0)}</span></div>
      {taskQuery.isLoading && <div className="mt-4"><SkeletonRows count={2}/></div>}
      {!taskQuery.isLoading && <>
        <AttentionGroup title="متأخرة" count={data.overdueTaskCount} tasks={overdueTasks} tone="late"/>
        <AttentionGroup title="تسليم خلال ٧ أيام" count={data.dueSoonTaskCount} tasks={dueSoonTasks} tone="soon"/>
        {member?.role==='manager'&&<AttentionGroup title="بلا مسؤول" count={unassignedTasks.length} tasks={unassignedTasks} tone="unassigned"/>}
        {taskQuery.isError&&<p className="mt-3 text-xs text-[#8d5d4f]">تعذر تحميل بعض تفاصيل المهام. الأعداد المعروضة من ملخص المكتب.</p>}
        {!taskQuery.isError&&!data.overdueTaskCount&&!data.dueSoonTaskCount&&!unassignedTasks.length&&<p className="py-5 text-sm text-[#6f7d75]">لا توجد مهام تحتاج متابعة عاجلة الآن.</p>}
      </>}
    </section>
    <div className="grid grid-cols-2 gap-3 md:grid-cols-4 md:gap-4">{cards.map(({label,value,icon:Icon,color,accent},i)=><div className="panel relative overflow-hidden p-4 md:p-5" key={label} data-testid={`stat-${label}`}><span className="absolute -left-4 -top-4 h-20 w-20 rounded-full opacity-60" style={{background:color}}/><div className="relative flex items-start justify-between"><div><p className="text-xs font-semibold text-[#79857e]">{label}</p><strong className="mt-4 block font-mono text-3xl font-semibold text-[#203b39]">{value}</strong></div><span className="grid h-9 w-9 place-items-center rounded-xl" style={{background:color,color:accent}}><Icon size={17}/></span></div><p className="relative mt-3 text-[10px] text-[#8a938c]">{i===0?`${data.projectCount} مشروع في المساحة`:i===1?'موزعة على كل المشاريع':i===2?'اتقفلت واتسلّمت':'محتاجة متابعة قريبة'}</p></div>)}</div>
    <div className="mt-7 grid gap-5 lg:grid-cols-[1.25fr_.75fr]">
      <section className="panel p-5 md:p-6"><div className="mb-6 flex items-center justify-between"><div><h2 className="font-bold text-[#304743]">حالة المهام</h2><p className="mt-1 text-xs text-[#87918b]">التوزيع الحالي لشغل الفريق</p></div><Activity size={18} className="text-[#729086]"/></div>
        <div className="mb-6 flex h-3 overflow-hidden rounded-full bg-[#ebe9df]">{breakdown.map((item,index)=><span key={item.status} style={{width:`${data.taskCount?Math.max(0,item.count/data.taskCount*100):0}%`,background:['#c8c3ad','#6b9c90','#dfa16d','#6b8d59'][index]}}/>)}</div>
        <div className="grid grid-cols-2 gap-y-4">{breakdown.map((item,index)=><div className="flex items-center gap-3" key={item.status}><span className="h-2.5 w-2.5 rounded-full" style={{background:['#c8c3ad','#6b9c90','#dfa16d','#6b8d59'][index]}}/><span className="text-xs text-[#77827c]">{arabicStatus[item.status]}</span><strong className="mr-auto font-mono text-sm text-[#304743]">{item.count}</strong></div>)}</div>
      </section>
      <section className="relative overflow-hidden rounded-[18px] bg-[#285e59] p-6 text-[#f8f5e9]"><span className="absolute -left-10 -top-10 h-40 w-40 rounded-full border border-white/10"/><span className="absolute -left-2 -top-2 h-24 w-24 rounded-full border border-white/10"/><span className="relative grid h-10 w-10 place-items-center rounded-xl bg-white/10"><CalendarDays size={18}/></span><p className="relative mt-5 text-xs text-[#c7d7ce]">التسليمات القريبة</p><strong className="relative mt-1 block font-mono text-4xl">{data.dueSoonTaskCount}</strong><p className="relative mt-2 max-w-[220px] text-xs leading-6 text-[#c7d7ce]">مهمة موعدها خلال الأيام الجاية. خلّي المتابعة بدري قبل ما تتراكم.</p><Link className="relative mt-5 inline-flex items-center gap-2 text-xs font-bold text-white no-underline" href="/tasks">شوف قائمة المهام <ArrowLeft size={14}/></Link></section>
    </div>
    <div className="mt-7 grid gap-6 lg:grid-cols-[1.2fr_.8fr]">
      <section className="panel p-5 md:p-6"><div className="mb-3 flex items-center justify-between"><div><h2 className="font-bold text-[#304743]">المهام القادمة</h2><p className="mt-1 text-xs text-[#87918b]">أقرب مواعيد التسليم</p></div><Link href="/tasks" className="text-xs font-bold text-[#39736a] no-underline">كل المهام <ArrowLeft className="mr-1 inline" size={13}/></Link></div>
        {data.upcomingTasks?.length?<div>{data.upcomingTasks.slice(0,5).map(task=><TaskRow task={task} key={task.id}/>)}</div>:<p className="py-8 text-center text-sm text-[#87918b]">مفيش تسليمات قريبة حالياً. يوم هادي!</p>}
      </section>
      <section className="panel p-5 md:p-6"><div className="mb-4 flex items-center justify-between"><div><h2 className="font-bold text-[#304743]">المشاريع</h2><p className="mt-1 text-xs text-[#87918b]">آخر صورة للمشاريع</p></div><Link href="/projects" className="text-xs font-bold text-[#39736a] no-underline">عرض الكل <ArrowLeft className="mr-1 inline" size={13}/></Link></div>
        {projects.isLoading?<SkeletonRows count={2}/>:projects.isError?<p className="text-sm text-[#a45848]">تعذر تحميل المشاريع.</p>:projects.data?.slice(0,4).map(project=><Link href={`/projects/${project.id}`} className="table-row flex items-center gap-3 py-3 no-underline" key={project.id}><span className="grid h-9 w-9 place-items-center rounded-xl bg-[#e5eee8] text-[#3f7569]"><BriefcaseBusiness size={16}/></span><div className="min-w-0 flex-1"><p className="truncate text-xs font-bold text-[#38524c]">{project.name}</p><p className="mt-1 text-[10px] text-[#89928c]">{project.client}</p></div><strong className="font-mono text-xs text-[#54766e]">{project.progress}%</strong></Link>)}
      </section>
    </div>
    <section className="mt-7 panel p-5 md:p-6"><div className="mb-4 flex items-center justify-between"><div><h2 className="font-bold text-[#304743]">آخر التحديثات</h2><p className="mt-1 text-xs text-[#87918b]">أحدث المهام اللي اتحركت في المكتب</p></div><span className="grid h-9 w-9 place-items-center rounded-xl bg-[#f0eee4] text-[#78877f]"><Activity size={17}/></span></div>
      {data.recentTasks?.length?<div>{data.recentTasks.slice(0,4).map(task=><TaskRow task={task} key={task.id}/>)}</div>:<p className="py-6 text-center text-sm text-[#87918b]">لسه مفيش تحديثات جديدة.</p>}
    </section>
  </main>;
}

function AttentionGroup({title,count,tasks,tone}:{title:string;count:number;tasks:Task[];tone:'late'|'soon'|'unassigned'}) {
  const toneClass = tone==='late'?'attention-late':tone==='soon'?'attention-soon':'attention-unassigned';
  return <div className={`attention-group ${toneClass}`}><div className="attention-group-title"><span>{title}</span><strong>{count}</strong></div>{tasks.length?<div className="attention-task-list">{tasks.slice(0,3).map(task=><Link key={task.id} href={`/projects/${task.projectId}`} className="attention-task" data-testid={`attention-task-${task.id}`}><span className="attention-task-copy"><strong>{task.title}</strong><small>{task.projectName}{task.assigneeId===null?' · غير معيّنة':''}</small></span><span className="attention-task-date">{fmtDate(task.dueDate)}</span></Link>)}</div>:<p className="attention-none">لا توجد مهام</p>}</div>;
}

function ProjectForm({ initial, onClose, onSubmit, busy, error }: { initial?: Project & {description?:string}; onClose:()=>void; onSubmit:(data:ProjectInput & {status?:Project['status']})=>void; busy:boolean; error?:string }) {
  const [form,setForm]=useState({name:initial?.name||'',client:initial?.client||'',location:initial?.location||'',description:initial?.description||'',startDate:initial?.startDate?.slice(0,10)||'',endDate:initial?.endDate?.slice(0,10)||'',status:initial?.status||'active'});
  const submit=(event:FormEvent)=>{event.preventDefault();onSubmit(form);};
  return <div className="modal-backdrop" onMouseDown={(e)=>e.target===e.currentTarget&&onClose()}><form className="modal" onSubmit={submit}>
    <div className="mb-6 flex items-start justify-between"><div><p className="text-xs font-bold text-[#d77850]">{initial?'تحديث بيانات':'مشروع جديد'}</p><h2 className="mt-2 text-2xl font-extrabold text-[#203b39]">{initial?'تعديل المشروع':'ضيف مشروع للمساحة'}</h2></div><button type="button" className="btn btn-ghost !p-2" onClick={onClose}><X size={18}/></button></div>
    <div className="grid gap-4 sm:grid-cols-2">
      <label><span className="field-label">اسم المشروع *</span><input required className="field" value={form.name} onChange={e=>setForm({...form,name:e.target.value})} placeholder="مثال: مبنى إداري — التجمع" data-testid="input-project-name"/></label>
      <label><span className="field-label">العميل</span><input className="field" value={form.client} onChange={e=>setForm({...form,client:e.target.value})} placeholder="اسم العميل"/></label>
      <label><span className="field-label">الموقع</span><input className="field" value={form.location} onChange={e=>setForm({...form,location:e.target.value})} placeholder="المدينة أو المنطقة"/></label>
      {initial&&<label><span className="field-label">حالة المشروع</span><select className="field" value={form.status} onChange={e=>setForm({...form,status:e.target.value as Project['status']})}>{Object.entries(arabicStatus).filter(([key])=>['active','on_hold','completed'].includes(key)).map(([key,label])=><option key={key} value={key}>{label}</option>)}</select></label>}
      <div className="grid grid-cols-2 gap-3">
        <label>
          <span className="field-label">تاريخ البداية *</span>
          <input type="date" required className="field ltr" value={form.startDate} onChange={e=>setForm({...form,startDate:e.target.value})} data-testid="input-project-start-date"/>
        </label>
        <label>
          <span className="field-label">تاريخ التسليم *</span>
          <input type="date" required min={form.startDate||undefined} className="field ltr" value={form.endDate} onChange={e=>setForm({...form,endDate:e.target.value})} data-testid="input-project-end-date"/>
        </label>
      </div>
      <label className="sm:col-span-2"><span className="field-label">نبذة عن المشروع</span><textarea className="field min-h-[90px] resize-y" value={form.description} onChange={e=>setForm({...form,description:e.target.value})} placeholder="تفاصيل تساعد الفريق يفهم نطاق الشغل"/></label>
    </div>
    {error&&<p className="mt-4 text-sm font-semibold text-[#a64d40]" role="alert">{error}</p>}
    <div className="mt-7 flex justify-end gap-2"><button type="button" className="btn btn-soft" onClick={onClose}>إلغاء</button><button disabled={busy} className="btn btn-primary">{busy&&<LoaderCircle className="animate-spin" size={15}/>} {initial?'حفظ التعديلات':'إنشاء المشروع'}</button></div>
  </form></div>;
}

function ProjectsPage() {
  const client=useQueryClient();
  const member=useContext(OfficeMemberContext);
  const canManage=member?.role==='manager';
  const {data:projects,isLoading,isError,refetch}=useListProjects();
  const create=useCreateProject();
  const [modal,setModal]=useState(false);const [search,setSearch]=useState('');
  const filtered=useMemo(()=>projects?.filter(p=>`${p.name} ${p.client} ${p.location}`.toLowerCase().includes(search.toLowerCase()))||[],[projects,search]);
  const submit=(data:ProjectInput & {status?:Project['status']})=>{const {status:_status,...projectInput}=data;create.mutate({data:projectInput},{onSuccess:()=>{client.invalidateQueries({queryKey:getListProjectsQueryKey()});client.invalidateQueries({queryKey:getGetOfficeDashboardQueryKey()});setModal(false);}});};
  return <main className="page-content"><PageTitle eyebrow="ملف الشغل" title="المشاريع" description="كل مشروع وموقفه الحالي في مكان واحد." action={canManage&&<button className="btn btn-primary" onClick={()=>setModal(true)} data-testid="button-create-project"><Plus size={17}/> مشروع جديد</button>}/>
    <div className="panel mb-6 flex flex-wrap items-center gap-3 p-4"><div className="relative min-w-[220px] flex-1"><Search size={17} className="absolute right-3 top-1/2 -translate-y-1/2 text-[#8a938c]"/><input className="field pr-10" value={search} onChange={e=>setSearch(e.target.value)} placeholder="دوّر باسم المشروع أو العميل..." data-testid="input-search-projects"/></div><div className="flex items-center gap-2 text-xs text-[#849089]"><SlidersHorizontal size={15}/>{projects?.length||0} مشروع</div></div>
    {isLoading?<SkeletonRows/>:isError?<ErrorState retry={()=>refetch()}/>:
      filtered.length?<div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{filtered.map((project,i)=><ProjectCard key={project.id} project={project} index={i}/>)}</div>:
       <EmptyState title={search?'ملقيناش نتيجة':'ابدأ بأول مشروع'} body={search?'جرّب كلمة بحث تانية أو امسح البحث.':'ضيف مشروعك الأول، وبعدها رتّب المهام والمسؤوليات جوّاه.'} action={!search&&canManage&&<button className="btn btn-primary" onClick={()=>setModal(true)}><Plus size={16}/> مشروع جديد</button>}/>}
    {modal&&canManage&&<ProjectForm onClose={()=>setModal(false)} onSubmit={submit} busy={create.isPending} error={create.isError?'تعذّر حفظ المشروع. راجع البيانات والتواريخ، ثم حاول مرة أخرى.':undefined}/>}
  </main>;
}
function ProjectCard({project,index}:{project:Project;index:number}) {
  const accents=['#39746a','#c77a50','#8d8a58','#547988'];
  return <Link href={`/projects/${project.id}`} className="panel project-card group relative overflow-hidden p-5 no-underline transition-transform hover:-translate-y-1" data-testid={`card-project-${project.id}`}><div className="absolute right-0 top-0 h-1 w-full origin-right transition-transform group-hover:scale-x-100" style={{background:accents[index%accents.length]}}/><div className="flex items-start justify-between"><span className="grid h-11 w-11 place-items-center rounded-[14px]" style={{background:`${accents[index%accents.length]}18`,color:accents[index%accents.length]}}><BriefcaseBusiness size={20}/></span><StatusBadge status={project.status}/></div><h2 className="mt-5 truncate text-lg font-extrabold text-[#304743]">{project.name}</h2><p className="mt-1 text-xs text-[#839089]">{project.client||'بدون عميل محدد'}</p><p className="mt-4 flex items-center gap-1 text-xs text-[#77827c]"><MapPin size={13}/>{project.location||'الموقع غير محدد'}</p><div className="project-scanline mt-5"><div className="project-scanline-item"><span>التقدم</span><strong className="font-mono">{project.progress||0}%</strong><span className="project-progress-track"><i style={{width:`${Math.min(100,project.progress||0)}%`}}/></span></div><div className="project-scanline-item"><span>الحالة</span><StatusBadge status={project.status}/></div><div className="project-scanline-item"><span>التسليم</span><strong className="project-delivery"><CalendarDays size={13}/>{fmtDate(project.endDate)}</strong></div></div><div className="mt-4 flex items-center justify-between text-[11px] text-[#8a938c]"><span>{project.completedTaskCount||0} من {project.taskCount||0} مهمة مكتملة</span><ArrowLeft size={15} className="text-[#6e8d82] transition-transform group-hover:-translate-x-1"/></div></Link>;
}

function ProjectDetailsPage() {
  const params=useParams<{projectId:string}>();const id=Number(params.projectId);
  const member=useContext(OfficeMemberContext);const canManage=member?.role==='manager';
  const [,setLocation]=useLocation();
  const client=useQueryClient();const query=useGetProject(id,{query:{queryKey:getGetProjectQueryKey(id)}});
  const update=useUpdateProject();const remove=useDeleteProject();const createTask=useCreateTask();const updateTask=useUpdateTask();const deleteTask=useDeleteTask();
  const [edit,setEdit]=useState(false);const [taskOpen,setTaskOpen]=useState(false);const [editingTask,setEditingTask]=useState<Task|undefined>();const [discussionTask,setDiscussionTask]=useState<Task|undefined>();
  const linkedTaskId = new URLSearchParams(window.location.search).get('taskId');
  useEffect(()=>{
    if(!query.data||!linkedTaskId)return;
    const linkedTask=query.data.tasks?.find(task=>task.id===Number(linkedTaskId));
    if(linkedTask){setDiscussionTask(linkedTask);setLocation(`/projects/${id}`);}
  },[query.data,linkedTaskId,id,setLocation]);
  if(!Number.isFinite(id)) return <main className="page-content"><EmptyState title="رقم المشروع مش صحيح" body="ارجع لقائمة المشاريع واختار مشروع تاني."/></main>;
  if(query.isLoading)return <main className="page-content"><div className="skeleton mb-6 h-12 w-72"/><SkeletonRows/></main>;
  if(query.isError||!query.data)return <main className="page-content"><ErrorState retry={()=>query.refetch()}/></main>;
  const project=query.data;
  const onUpdate=(data:ProjectInput & {status?:Project['status']})=>update.mutate({projectId:id,data},{onSuccess:()=>{client.invalidateQueries({queryKey:getGetProjectQueryKey(id)});client.invalidateQueries({queryKey:getListProjectsQueryKey()});setEdit(false);}});
  const onDelete=()=>{if(window.confirm('متأكد إنك عايز تحذف المشروع؟ حذف المشروع ممكن يأثر على المهام المرتبطة.'))remove.mutate({projectId:id},{onSuccess:()=>{client.invalidateQueries({queryKey:getListProjectsQueryKey()});client.invalidateQueries({queryKey:getGetOfficeDashboardQueryKey()});setLocation('/projects');}});};
  const refreshTasks=()=>{client.invalidateQueries({queryKey:getGetProjectQueryKey(id)});client.invalidateQueries({queryKey:getListTasksQueryKey()});client.invalidateQueries({queryKey:getGetOfficeDashboardQueryKey()});client.invalidateQueries({queryKey:getListProjectsQueryKey()});};
  const submitTask=(value:TaskInput|{taskId:number;data:TaskUpdate})=>{
    const options={onSuccess:()=>{refreshTasks();setTaskOpen(false);setEditingTask(undefined);}};
    if('taskId' in value) updateTask.mutate({taskId:value.taskId,data:value.data},{onSuccess:()=>{options.onSuccess();client.invalidateQueries({queryKey:getGetTaskDiscussionQueryKey(value.taskId)});client.invalidateQueries({queryKey:getListOfficeNotificationsQueryKey()});}});
    else createTask.mutate({data:value},options);
  };
  const removeTask=(task:Task)=>{if(window.confirm(`حذف المهمة «${task.title}»؟`))deleteTask.mutate({taskId:task.id},{onSuccess:refreshTasks});};
  return <main className="page-content">
    <Link href="/projects" className="mb-5 inline-flex items-center gap-2 text-xs font-bold text-[#71817a] no-underline"><ArrowRightIcon/> رجوع للمشاريع</Link>
     <div className="panel overflow-hidden"><div className="relative bg-[#285e59] p-6 text-[#f8f5e9] md:p-9"><div className="absolute -left-12 -top-20 h-56 w-56 rounded-full border border-white/10"/><div className="relative flex flex-wrap items-start justify-between gap-5"><div><div className="mb-3 flex items-center gap-2"><StatusBadge status={project.status}/><span className="text-xs text-[#bfd0c8]">{project.client||'بدون عميل'}</span></div><h1 className="text-3xl font-extrabold tracking-tight md:text-4xl" data-testid="text-project-name">{project.name}</h1><p className="mt-3 flex items-center gap-2 text-sm text-[#c2d1ca]"><MapPin size={15}/>{project.location||'الموقع غير محدد'}</p></div>{canManage&&<div className="flex gap-2"><button className="btn bg-white/10 text-white hover:bg-white/20" onClick={()=>setEdit(true)}><Pencil size={15}/> تعديل</button><button className="btn bg-white/10 text-white hover:bg-[#a64d40]" onClick={onDelete} disabled={remove.isPending}><Trash2 size={15}/> حذف</button></div>}</div><div className="relative mt-8 grid grid-cols-2 gap-4 border-t border-white/15 pt-6 md:grid-cols-4"><div><p className="text-[11px] text-[#b7c9c0]">نسبة الإنجاز</p><strong className="mt-1 block font-mono text-2xl">{project.progress}%</strong></div><div><p className="text-[11px] text-[#b7c9c0]">المهام المكتملة</p><strong className="mt-1 block font-mono text-2xl">{project.completedTaskCount} <span className="text-sm text-[#b7c9c0]">/ {project.taskCount}</span></strong></div><div><p className="text-[11px] text-[#b7c9c0]">بداية المشروع</p><strong className="mt-2 block text-sm">{fmtDate(project.startDate)}</strong></div><div><p className="text-[11px] text-[#b7c9c0]">موعد التسليم</p><strong className="mt-2 block text-sm">{fmtDate(project.endDate)}</strong></div></div></div>
       <div className="p-6 md:p-8"><div className="flex flex-wrap items-center justify-between gap-4"><div><h2 className="text-xl font-extrabold text-[#304743]">مهام المشروع</h2><p className="mt-1 text-xs text-[#87918b]">{project.tasks?.length||0} مهمة مرتبطة بالمشروع</p></div>{canManage&&<button className="btn btn-primary" onClick={()=>setTaskOpen(true)}><Plus size={16}/> أضف مهمة</button>}</div>
        {project.description&&<p className="mt-5 max-w-3xl text-sm leading-7 text-[#74817a]">{project.description}</p>}
          <div className="mt-6">
            <AttachmentsPanel scope="project" projectId={id} canUpload={canManage}/>
          </div>
          {project.tasks?.length?<div className="mt-6">{project.tasks.map(task=><TaskRow task={task} key={task.id} onEdit={task=>{setEditingTask(task);setTaskOpen(true);}} onDelete={removeTask} onDiscussion={setDiscussionTask}/>)}</div>:<div className="mt-6"><EmptyState title="المشروع لسه من غير مهام" body="سجّل أول مهمة وحدد المسؤول وموعد التسليم عشان يبدأ الشغل." action={canManage&&<button className="btn btn-primary" onClick={()=>setTaskOpen(true)}><Plus size={15}/> أضف مهمة</button>}/></div>}
      </div></div>
     {edit&&canManage&&<ProjectForm initial={project} onClose={()=>setEdit(false)} onSubmit={onUpdate} busy={update.isPending} error={update.isError?'تعذّر حفظ التعديلات. راجع البيانات والتواريخ، ثم حاول مرة أخرى.':undefined}/>}
     {taskOpen&&(canManage||editingTask?.assigneeId===member?.id)&&<TaskForm projects={[project]} initialProjectId={id} initial={editingTask} onClose={()=>{setTaskOpen(false);setEditingTask(undefined);}} onSubmit={submitTask} busy={createTask.isPending||updateTask.isPending}/>}
      {discussionTask&&<TaskDiscussionDialog task={discussionTask} canUpload={canManage||discussionTask.assigneeId===member?.id} onClose={()=>setDiscussionTask(undefined)}/>}
  </main>;
}
function ArrowRightIcon(){return <ArrowUpRight className="rotate-[-135deg]" size={14}/>}

function TaskForm({projects,initial,initialProjectId,onClose,onSubmit,busy}:{projects:Project[];initial?:Task;initialProjectId?:number;onClose:()=>void;onSubmit:(data:TaskInput|{taskId:number;data:TaskUpdate})=>void;busy:boolean}) {
  const members=useListOfficeMembers();
  const member=useContext(OfficeMemberContext);
  const canManage=member?.role==='manager';
  const isAssignedEngineer=initial?.assigneeId===member?.id;
  const lockAssignmentFields=Boolean(initial&&!canManage);
  const [form,setForm]=useState({projectId:String(initial?.projectId||initialProjectId||projects[0]?.id||''),title:initial?.title||'',description:initial?.description||'',category:initial?.category||'shop_drawing',priority:initial?.priority||'medium',status:initial?.status||'todo',assigneeId:initial?.assigneeId?String(initial.assigneeId):'',dueDate:initial?.dueDate?.slice(0,10)||''});
  const submit=(e:FormEvent)=>{e.preventDefault();const data:TaskInput={projectId:Number(form.projectId),title:form.title,description:form.description,category:form.category as TaskInput['category'],priority:form.priority as TaskInput['priority'],assigneeId:form.assigneeId?Number(form.assigneeId):null,dueDate:form.dueDate};if(initial)onSubmit({taskId:initial.id,data:{title:data.title,description:data.description,category:data.category,priority:data.priority,status:form.status as TaskUpdate['status'],assigneeId:data.assigneeId,dueDate:data.dueDate}});else onSubmit(data);};
  return <div className="modal-backdrop" onMouseDown={e=>e.target===e.currentTarget&&onClose()}><form onSubmit={submit} className="modal">
    <div className="mb-6 flex items-start justify-between"><div><p className="text-xs font-bold text-[#d77850]">{initial?'تعديل وتحديث':'تكليف جديد'}</p><h2 className="mt-2 text-2xl font-extrabold text-[#203b39]">{initial?'تعديل المهمة':'مهمة جديدة'}</h2></div><button type="button" className="btn btn-ghost !p-2" onClick={onClose}><X size={18}/></button></div>
    <div className="grid gap-4 sm:grid-cols-2"><label className="sm:col-span-2"><span className="field-label">عنوان المهمة *</span><input required disabled={lockAssignmentFields} className="field" value={form.title} onChange={e=>setForm({...form,title:e.target.value})} placeholder="مثال: مراجعة رسومات الدور الأرضي" data-testid="input-task-title"/></label>
      <label className="sm:col-span-2"><span className="field-label">المشروع *</span><select required disabled={lockAssignmentFields} className="field" value={form.projectId} onChange={e=>setForm({...form,projectId:e.target.value})}>{projects.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
      <label><span className="field-label">التصنيف</span><select disabled={lockAssignmentFields} className="field" value={form.category} onChange={e=>setForm({...form,category:e.target.value as TaskInput['category']})}>{Object.entries(arabicCategory).map(([key,label])=><option key={key} value={key}>{label}</option>)}</select></label>
      <label><span className="field-label">الأولوية</span><select disabled={lockAssignmentFields} className="field" value={form.priority} onChange={e=>setForm({...form,priority:e.target.value as TaskInput['priority']})}>{Object.entries(arabicPriority).map(([key,label])=><option key={key} value={key}>{label}</option>)}</select></label>
      <label><span className="field-label">المسؤول</span><select disabled={lockAssignmentFields} className="field" value={form.assigneeId} onChange={e=>setForm({...form,assigneeId:e.target.value})}><option value="">غير معيّنة</option>{members.data?.map(member=><option value={member.id} key={member.id}>{member.name}</option>)}</select></label>
      <label><span className="field-label">موعد التسليم *</span><input required disabled={lockAssignmentFields} type="date" className="field ltr" value={form.dueDate} onChange={e=>setForm({...form,dueDate:e.target.value})}/></label>
      {initial&&<label className="sm:col-span-2"><span className="field-label">الحالة</span><select disabled={!canManage&&!isAssignedEngineer} className="field" value={form.status} onChange={e=>setForm({...form,status:e.target.value as Task['status']})}>{Object.entries(arabicStatus).filter(([key])=>['todo','in_progress','review','done'].includes(key)).map(([key,label])=><option value={key} key={key}>{label}</option>)}</select></label>}
      <label className="sm:col-span-2"><span className="field-label">تفاصيل المهمة</span><textarea disabled={!canManage&&!isAssignedEngineer} className="field min-h-[85px] resize-y" value={form.description} onChange={e=>setForm({...form,description:e.target.value})} placeholder="ملاحظات أو نطاق المطلوب"/></label>
    </div>
    <div className="mt-7 flex justify-end gap-2"><button type="button" className="btn btn-soft" onClick={onClose}>إلغاء</button><button disabled={busy} className="btn btn-primary">{busy&&<LoaderCircle className="animate-spin" size={15}/>} {initial?'حفظ التغييرات':'إنشاء المهمة'}</button></div>
  </form></div>;
}

function TasksPage() {
  const client=useQueryClient();const member=useContext(OfficeMemberContext);const canManage=member?.role==='manager';const query=useListTasks();const projectsQuery=useListProjects();const create=useCreateTask();const update=useUpdateTask();const remove=useDeleteTask();
  const [search,setSearch]=useState('');const [status,setStatus]=useState('all');const [project,setProject]=useState('all');const [modal,setModal]=useState(false);const [editing,setEditing]=useState<Task|undefined>();const [discussionTask,setDiscussionTask]=useState<Task|undefined>();
  const rows=useMemo(()=>query.data?.filter(task=>(status==='all'||task.status===status)&&(project==='all'||task.projectId===Number(project))&&(`${task.title} ${task.projectName} ${task.assigneeName||''}`.toLowerCase().includes(search.toLowerCase())))||[],[query.data,status,project,search]);
  const hasFilters=Boolean(search.trim())||status!=='all'||project!=='all';
  const clearFilters=()=>{setSearch('');setStatus('all');setProject('all');};
  const done=()=>{client.invalidateQueries({queryKey:getListTasksQueryKey()});client.invalidateQueries({queryKey:getGetOfficeDashboardQueryKey()});client.invalidateQueries({queryKey:getListProjectsQueryKey()});};
  const onSubmit=(value:TaskInput|{taskId:number;data:TaskUpdate})=>{if('taskId'in value)update.mutate({taskId:value.taskId,data:value.data},{onSuccess:()=>{done();setModal(false);setEditing(undefined);client.invalidateQueries({queryKey:getGetTaskDiscussionQueryKey(value.taskId)});client.invalidateQueries({queryKey:getListOfficeNotificationsQueryKey()});}});else create.mutate({data:value},{onSuccess:()=>{done();setModal(false);}});};
  const onDelete=(task:Task)=>{if(window.confirm(`حذف المهمة «${task.title}»؟`))remove.mutate({taskId:task.id},{onSuccess:done});};
  return <main className="page-content"><PageTitle eyebrow="التكليفات والمتابعة" title="المهام" description="فلتر شغل الفريق، حدّث الحالات، وخلي كل موعد ظاهر." action={canManage&&<button className="btn btn-primary disabled:cursor-not-allowed disabled:opacity-50" disabled={!projectsQuery.data?.length} onClick={()=>{setEditing(undefined);setModal(true);}} data-testid="button-create-task"><Plus size={17}/> مهمة جديدة</button>}/>
     <div className="panel mb-5 task-filters p-4"><div className="task-filter-controls"><div className="relative min-w-0 flex-1"><Search size={16} className="absolute right-3 top-1/2 -translate-y-1/2 text-[#89928b]"/><input className="field pr-10" placeholder="ابحث عن مهمة أو مشروع أو مسؤول..." value={search} onChange={e=>setSearch(e.target.value)} data-testid="input-search-tasks"/></div><select className="field task-project-select" value={project} onChange={e=>setProject(e.target.value)} data-testid="select-filter-project"><option value="all">كل المشاريع</option>{projectsQuery.data?.map(p=><option value={p.id} key={p.id}>{p.name}</option>)}</select>{hasFilters&&<button type="button" className="btn btn-soft task-clear-button" onClick={clearFilters} data-testid="button-clear-task-filters"><X size={15}/> مسح الفلاتر</button>}</div><div className="task-status-choices" role="group" aria-label="اختيار حالة المهام">{[['all','كل الحالات'],...Object.entries(arabicStatus).filter(([key])=>['todo','in_progress','review','done'].includes(key))].map(([value,label])=><button type="button" key={value} className={`task-status-choice ${status===value?'selected':''}`} aria-pressed={status===value} onClick={()=>setStatus(value)} data-testid={`button-filter-status-${value}`}>{label}</button>)}</div></div>
     {query.isLoading?<SkeletonRows/>:query.isError?<ErrorState retry={()=>query.refetch()}/>:rows.length?<section className="panel px-5 py-2 md:px-7"><div className="grid grid-cols-[minmax(0,1.5fr)_minmax(110px,.8fr)_minmax(90px,.6fr)_minmax(86px,.55fr)_auto] gap-4 border-b border-[#e6e3d9] py-3 text-[10px] font-bold text-[#929991] max-md:hidden"><span>المهمة / المشروع</span><span>المسؤول</span><span>الحالة</span><span>التسليم</span><span/></div>{rows.map(task=><TaskRow key={task.id} task={task} onEdit={t=>{setEditing(t);setModal(true);}} onDelete={onDelete} onDiscussion={setDiscussionTask}/>)}</section>:<EmptyState title={search||status!=='all'||project!=='all'?'مفيش مهام بالاختيارات دي':'لسه مفيش مهام'} body="ابدأ بتكليف جديد، أو غيّر الفلاتر عشان تظهر نتائج أكتر." action={canManage&&<button className="btn btn-primary" onClick={()=>setModal(true)}><Plus size={15}/> مهمة جديدة</button>}/>}
    {modal&&(canManage||editing?.assigneeId===member?.id)&&<TaskForm projects={projectsQuery.data||[]} initial={editing} onClose={()=>{setModal(false);setEditing(undefined);}} onSubmit={onSubmit} busy={create.isPending||update.isPending}/>}
     {discussionTask&&<TaskDiscussionDialog task={discussionTask} canUpload={canManage||discussionTask.assigneeId===member?.id} onClose={()=>setDiscussionTask(undefined)}/>}
  </main>;
}

function TeamPage() {
  const client=useQueryClient();
  const members=useListOfficeMembers();
  const invitations=useListOfficeInvitations();
  const create=useCreateOfficeInvitation();
  const revoke=useRevokeOfficeInvitation();
  const [email,setEmail]=useState('');
  const [message,setMessage]=useState('');

  const onInvite=(event:FormEvent)=>{
    event.preventDefault();
    setMessage('');
    create.mutate({data:{email:email.trim()}},{
      onSuccess:(invitation:OfficeInvitation)=>{
        setMessage(`تم إرسال دعوة إلى ${invitation.email}.`);
        setEmail('');
        client.invalidateQueries({queryKey:getListOfficeInvitationsQueryKey()});
      },
      onError:()=>setMessage('تعذر إرسال الدعوة. تأكد أن البريد غير مضاف للفريق وأنه لا توجد دعوة معلقة له.'),
    });
  };
  const onRevoke=(invitation:OfficeInvitation)=>{
    if(!window.confirm(`إلغاء الدعوة المرسلة إلى ${invitation.email}؟`)) return;
    revoke.mutate({invitationId:invitation.id},{
      onSuccess:()=>{
        setMessage(`تم إلغاء دعوة ${invitation.email}.`);
        client.invalidateQueries({queryKey:getListOfficeInvitationsQueryKey()});
      },
      onError:()=>setMessage('لم نتمكن من إلغاء الدعوة. قد تكون قُبلت بالفعل أو انتهت صلاحيتها.'),
    });
  };

  return <main className="page-content">
    <PageTitle eyebrow="إدارة الوصول" title="فريق المكتب" description="أرسل دعوة لكل مهندس يحتاج دخول مساحة المكتب، وتابع حالة الدعوات."/>
    <section className="panel p-5 md:p-7">
      <div className="mb-5"><h2 className="text-lg font-extrabold text-[#304743]">دعوة مهندس</h2><p className="mt-1 text-sm text-[#87918b]">هنبعت رابط دعوة إلى البريد، ويُستخدم مرة واحدة للانضمام للمكتب.</p></div>
      <form onSubmit={onInvite} className="flex flex-wrap gap-3">
        <input className="field min-w-[220px] flex-1 text-left" type="email" dir="ltr" required maxLength={254} placeholder="engineer@company.com" value={email} onChange={event=>setEmail(event.target.value)} data-testid="input-invitation-email"/>
        <button className="btn btn-primary disabled:opacity-50" disabled={create.isPending} data-testid="button-send-invitation">{create.isPending?<LoaderCircle size={16} className="animate-spin"/>:<Plus size={16}/>} إرسال الدعوة</button>
      </form>
      {message&&<p className="mt-3 text-sm font-semibold text-[#386d60]" role="status">{message}</p>}
    </section>

    <section className="panel mt-5 p-5 md:p-7">
      <div className="mb-4 flex items-center justify-between"><div><h2 className="text-lg font-extrabold text-[#304743]">أعضاء المكتب</h2><p className="mt-1 text-xs text-[#87918b]">الأشخاص الذين انضموا إلى مساحة العمل.</p></div><span className="rounded-full bg-[#e9efe8] px-3 py-1 text-xs font-bold text-[#386d60]">{members.data?.length||0}</span></div>
      {members.isLoading?<SkeletonRows count={2}/>:members.isError?<ErrorState retry={()=>members.refetch()}/>:members.data?.length?<div className="divide-y divide-[#ece9df]">{members.data.map(member=><div key={member.id} className="flex flex-wrap items-center gap-3 py-3" data-testid={`row-office-member-${member.id}`}><span className="grid h-10 w-10 place-items-center rounded-xl bg-[#e4efeb] text-sm font-extrabold text-[#386d60]">{initials(member.name)}</span><div className="min-w-0 flex-1"><p className="truncate text-sm font-bold text-[#304743]">{member.name}</p><p className="mt-1 truncate text-xs text-[#87918b]" dir="ltr">{member.email}</p></div><span className="badge">{member.role==='manager'?'مدير المكتب':'مهندس'}</span></div>)}</div>:<p className="py-6 text-center text-sm text-[#87918b]">لسه مفيش أعضاء.</p>}
    </section>

    <section className="panel mt-5 p-5 md:p-7">
      <div className="mb-4 flex items-center justify-between"><div><h2 className="text-lg font-extrabold text-[#304743]">الدعوات</h2><p className="mt-1 text-xs text-[#87918b]">الدعوة تنتهي بعد 30 يومًا إذا لم تُقبل.</p></div><button className="btn btn-ghost !p-2" onClick={()=>invitations.refetch()} aria-label="تحديث الدعوات"><RefreshCw size={15}/></button></div>
      {invitations.isLoading?<SkeletonRows count={2}/>:invitations.isError?<ErrorState retry={()=>invitations.refetch()}/>:invitations.data?.length?<div className="divide-y divide-[#ece9df]">{invitations.data.map(invitation=><div key={invitation.id} className="flex flex-wrap items-center gap-3 py-3" data-testid={`row-office-invitation-${invitation.id}`}><span className="grid h-9 w-9 place-items-center rounded-xl bg-[#f5eadc] text-[#a56d36]"><Activity size={16}/></span><div className="min-w-0 flex-1"><p className="truncate text-sm font-bold text-[#304743]" dir="ltr">{invitation.email}</p><p className="mt-1 text-xs text-[#87918b]">{invitation.status==='pending'?'بانتظار القبول':invitation.status==='accepted'?'تم القبول':invitation.status==='expired'?'انتهت الصلاحية':'ملغاة'} · تنتهي {fmtDate(invitation.expiresAt)}</p></div>{invitation.status==='pending'&&<button className="btn btn-ghost !p-2 hover:text-[#b84c40]" title="إلغاء الدعوة" onClick={()=>onRevoke(invitation)} disabled={revoke.isPending} data-testid={`button-revoke-invitation-${invitation.id}`}><X size={16}/></button>}</div>)}</div>:<p className="py-6 text-center text-sm text-[#87918b]">مفيش دعوات مرسلة.</p>}
    </section>
  </main>;
}

function Protected({children}:{children:ReactNode}) {
  return passwordAuthEnabled
    ? <PasswordProtected>{children}</PasswordProtected>
    : <ClerkProtected>{children}</ClerkProtected>;
}
function ClerkProtected({children}:{children:ReactNode}) {
  const {state:access,failure}=useContext(OfficeAccessContext);
  return <><Show when="signed-in">{access==='member'?children:access==='blocked'?<InvitationRequiredPage failure={failure}/>:<div className="grid min-h-[70vh] place-items-center"><LoaderCircle size={28} className="animate-spin text-[#285e59]"/></div>}</Show><Show when="signed-out"><Redirect to="/"/></Show></>;
}
function PasswordProtected({children}:{children:ReactNode}) {
  const {member,state,failure}=useOfficePasswordAuth();
  if(state==='checking') return <div className="grid min-h-[70vh] place-items-center"><LoaderCircle size={28} className="animate-spin text-[#285e59]"/></div>;
  if(state==='failed') return <main className="page-content"><div className="panel p-6 text-center text-sm text-[#a64d40]" role="alert">{failure}</div></main>;
  if(state==='signed-out'||!member) return <Redirect to="/sign-in"/>;
  return <OfficeMemberContext.Provider value={member}>{children}</OfficeMemberContext.Provider>;
}
function InvitationRequiredPage({failure}:{failure?:OfficeAccessFailure}) {
  const {signOut}=useClerk();
  const {user}=useUser();
  const issue=failure??classifyOfficeAccessFailure(undefined);
  return <main className="grid min-h-[100dvh] place-items-center bg-[#f7f5ed] px-5 py-12" dir="rtl"><section className="panel w-full max-w-lg p-8 text-center" role="alert" data-testid={`office-access-${issue.kind}`}><div className="mx-auto flex w-fit"><Brand/></div><div className="mx-auto mt-8 grid h-14 w-14 place-items-center rounded-2xl bg-[#f8e9df] text-[#a64d40]"><CircleAlert size={25}/></div><h1 className="mt-5 text-2xl font-extrabold text-[#203b39]">{issue.title}</h1><p className="mt-3 text-sm leading-7 text-[#71807a]">{issue.description}</p>{user?.primaryEmailAddress?.emailAddress&&<p className="mt-4 break-all text-sm text-[#304743]" data-testid="office-access-current-email">الحساب الحالي: <span dir="ltr">{user.primaryEmailAddress.emailAddress}</span></p>}{issue.status&&<p className="mt-2 text-xs text-[#87918b]" data-testid="office-access-status">رمز الاستجابة: {issue.status}</p>}<div className="mt-6 flex flex-wrap justify-center gap-2"><button className="btn btn-primary" onClick={()=>window.location.reload()}>إعادة التحقق</button><button className="btn btn-soft" onClick={()=>signOut({redirectUrl:basePath||'/'})}>تسجيل الخروج</button><Link href="/" className="btn btn-soft">الصفحة الرئيسية</Link></div></section></main>;
}
function ManagerOnly({children}:{children:ReactNode}) {
  const member=useContext(OfficeMemberContext);
  if(!member) return <div className="grid min-h-[60vh] place-items-center"><LoaderCircle size={25} className="animate-spin text-[#285e59]"/></div>;
  return member.role==='manager'?children:<Redirect to="/dashboard"/>;
}
function HomeRedirect() {
  return passwordAuthEnabled ? <PasswordHomeRedirect/> : <ClerkHomeRedirect/>;
}
function ClerkHomeRedirect() {
  return <><Show when="signed-in"><Redirect to="/dashboard"/></Show><Show when="signed-out"><HomePage/></Show></>;
}
function PasswordHomeRedirect() {
  const {state}=useOfficePasswordAuth();
  if(state==='checking') return <div className="grid min-h-[70vh] place-items-center"><LoaderCircle size={28} className="animate-spin text-[#285e59]"/></div>;
  if(state==='signed-in') return <Redirect to="/dashboard"/>;
  return <HomePage/>;
}
function PasswordProviderWithRoutes() {
  return <QueryClientProvider client={queryClient}>
    <OfficePasswordAuthProvider>
      <Switch>
        <Route path="/" component={PasswordHomeRedirect}/>
        <Route path="/sign-in/*?" component={PasswordSignInPage}/>
        <Route path="/sign-up/*?" component={()=><Redirect to="/sign-in"/>}/>
        <Route path="/dashboard"><Protected><NavShell><DashboardPage/></NavShell></Protected></Route>
        <Route path="/projects"><Protected><NavShell><ProjectsPage/></NavShell></Protected></Route>
        <Route path="/projects/:projectId"><Protected><NavShell><ProjectDetailsPage/></NavShell></Protected></Route>
        <Route path="/tasks"><Protected><NavShell><TasksPage/></NavShell></Protected></Route>
        <Route path="/team"><Protected><NavShell><ManagerOnly><PasswordTeamPage/></ManagerOnly></NavShell></Protected></Route>
        <Route component={NotFound}/>
      </Switch>
    </OfficePasswordAuthProvider>
  </QueryClientProvider>;
}
function ClerkProviderWithRoutes() {
  const [,setLocation]=useLocation();
  return <ClerkProvider publishableKey={clerkPubKey} proxyUrl={clerkProxyUrl} appearance={clerkAppearance} signInUrl={`${basePath}/sign-in`} signUpUrl={`${basePath}/sign-up`}
    localization={{signIn:{start:{title:'أهلاً بعودتك',subtitle:'سجّل دخولك لمساحة المكتب الفني'}},signUp:{start:{title:'أنشئ حسابك',subtitle:'ابدأ تنظيم شغل فريقك الهندسي'}}}}
    routerPush={to=>setLocation(stripBase(to))} routerReplace={to=>setLocation(stripBase(to),{replace:true})}>
     <ClerkLoading><AuthStatus state="loading"/></ClerkLoading>
     <ClerkFailed><AuthStatus state="failed"/></ClerkFailed>
     <QueryClientProvider client={queryClient}><ClerkQueryClientCacheInvalidator/><ProfileSync>
       <Switch>
        <Route path="/" component={HomeRedirect}/>
        <Route path="/sign-in/*?" component={SignInPage}/>
        <Route path="/sign-up/*?" component={SignUpPage}/>
        <Route path="/dashboard"><Protected><NavShell><DashboardPage/></NavShell></Protected></Route>
        <Route path="/projects"><Protected><NavShell><ProjectsPage/></NavShell></Protected></Route>
        <Route path="/projects/:projectId"><Protected><NavShell><ProjectDetailsPage/></NavShell></Protected></Route>
        <Route path="/tasks"><Protected><NavShell><TasksPage/></NavShell></Protected></Route>
         <Route path="/team"><Protected><NavShell><ManagerOnly><TeamPage/></ManagerOnly></NavShell></Protected></Route>
        <Route component={NotFound}/>
       </Switch>
     </ProfileSync>
    </QueryClientProvider>
  </ClerkProvider>;
}
function App() {
  if(passwordAuthEnabled) return <WouterRouter base={basePath}><PasswordProviderWithRoutes/></WouterRouter>;
  if(!clerkPubKey) return <AuthStatus state="missing"/>;
  return <WouterRouter base={basePath}><ClerkProviderWithRoutes/></WouterRouter>;
}
export default App;
