import { Link } from 'wouter';
import { ArrowRight, CircleHelp, FolderKanban } from 'lucide-react';

export default function NotFound() {
  return (
    <main dir="rtl" className="landing-grid grid min-h-[100dvh] place-items-center bg-[#f7f5ed] px-5">
      <section className="panel w-full max-w-lg p-8 text-center md:p-12">
        <div className="mx-auto grid h-16 w-16 place-items-center rounded-[20px] bg-[#e7efeb] text-[#39746a]">
          <CircleHelp size={30} />
        </div>
        <p className="mt-7 font-mono text-sm font-semibold tracking-[.2em] text-[#d77850]">404</p>
        <h1 className="mt-3 text-3xl font-extrabold text-[#203b39]">الصفحة مش موجودة</h1>
        <p className="mx-auto mt-3 max-w-sm text-sm leading-7 text-[#77827c]">
          غالباً الرابط اتغيّر أو الصفحة اتحركت. ارجع لمساحة الشغل وكمل من هناك.
        </p>
        <Link href="/dashboard" className="btn btn-primary mt-7">
          <FolderKanban size={16} /> رجوع لمساحة العمل <ArrowRight size={15} />
        </Link>
      </section>
    </main>
  );
}
