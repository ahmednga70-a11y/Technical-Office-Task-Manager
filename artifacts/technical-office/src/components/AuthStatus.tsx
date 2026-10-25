import { LoaderCircle } from "lucide-react";

export default function AuthStatus({ state }: { state: "missing" | "loading" | "failed" }) {
  const messages = {
    missing: {
      title: "تسجيل الدخول لم يُجهّز بعد",
      description: "يلزم ضبط إعدادات Clerk المستقل في منصة النشر ثم إعادة بناء التطبيق. لم يتم تحميل أي بيانات خاصة.",
    },
    loading: {
      title: "جارٍ تجهيز تسجيل الدخول",
      description: "إذا استمر الانتظار، تحقق من اتصال الإنترنت وإعدادات تسجيل الدخول على منصة النشر.",
    },
    failed: {
      title: "تعذّر تحميل تسجيل الدخول",
      description: "حاول إعادة تحميل الصفحة. إذا استمرت المشكلة، يحتاج مسؤول التطبيق إلى مراجعة إعدادات Clerk والدومين المنشور.",
    },
  };
  const message = messages[state];
  return (
    <main className="grid min-h-screen place-items-center bg-[#f7f5ed] px-5" dir="rtl" data-testid={`auth-status-${state}`}>
      <section className="panel w-full max-w-lg p-8 text-center" role={state === "loading" ? "status" : "alert"}>
        {state === "loading" && <LoaderCircle className="mx-auto mb-4 animate-spin text-[#285e59]" size={28} aria-hidden />}
        <h1 className="text-xl font-bold text-[#203b39]">{message.title}</h1>
        <p className="mt-4 text-sm leading-7 text-[#71807a]">{message.description}</p>
        {state !== "loading" && <button type="button" className="btn btn-primary mt-6" onClick={() => window.location.reload()} data-testid="button-reload-auth">إعادة تحميل الصفحة</button>}
      </section>
    </main>
  );
}
