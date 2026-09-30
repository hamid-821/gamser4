import fs from "node:fs";
import path from "node:path";

export const dynamic = "force-dynamic";

export default function PreviewInfo() {
  const keyFile = path.join(process.cwd(), "appg", "data-app", "admin-key.txt");
  let key = "";
  try { key = fs.readFileSync(keyFile, "utf8").trim(); } catch { key = "(هنوز ساخته نشده — یک بار صفحهٔ اصلی را باز کن)"; }
  return (
    <main dir="rtl" className="min-h-screen bg-[#17111f] px-6 py-12 text-[#f3ecff]">
      <section className="mx-auto max-w-2xl rounded-3xl border border-white/10 bg-white/5 p-8">
        <h1 className="text-2xl font-black">پیش‌نمایش گی‌میفای ۲.۱</h1>
        <p className="mt-3 text-sm leading-7 text-[#a893c0]">
          بازی اصلی روی <a className="text-amber-300 underline" href="/">/</a> اجرا می‌شود. دکمهٔ شناور «قبیله» پایین صفحه، هاب قبیله/نبرد/تورنمنت/سازمان را باز می‌کند.
        </p>
        <h2 className="mt-6 font-bold">کلید مدیر سرور (برای پنل نظارت در هاب → 🔑)</h2>
        <code dir="ltr" className="mt-2 block break-all rounded-xl bg-black/40 p-3 text-amber-200">{key}</code>
        <p className="mt-6 text-sm leading-7 text-[#a893c0]">
          بستهٔ به‌روزرسانی سرور: <a className="text-amber-300 underline" href="/appg-update.zip">appg-update.zip</a> · راهنما در فایل README-FA.md داخل بسته.
        </p>
      </section>
    </main>
  );
}
