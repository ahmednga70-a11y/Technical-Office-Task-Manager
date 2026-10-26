import { BellRing, BellOff, LoaderCircle, Send } from 'lucide-react';
import type { usePhoneNotifications } from '@/hooks/use-phone-notifications';

export default function PhoneNotificationControls({ phone }: { phone: ReturnType<typeof usePhoneNotifications> }) {
  return (
    <div className="shrink-0 border-b border-[#e8e4d9] bg-[#edf3ef] px-4 py-3" data-testid="phone-notification-controls">
      <h3 className="text-sm font-bold text-[#294641]">تنبيهات الهاتف</h3>
      {phone.needsInstallation ? (
        <p className="mt-2 text-xs leading-5 text-[#53685c]">على آيفون، أضف التطبيق إلى الشاشة الرئيسية، ثم افتحه من أيقونته لتفعيل التنبيهات.</p>
      ) : !phone.supported ? (
        <p className="mt-2 text-xs leading-5 text-[#53685c]">هذا المتصفح لا يدعم تنبيهات الهاتف. افتح التطبيق في متصفح حديث يدعم التنبيهات.</p>
      ) : phone.loading ? (
        <p className="mt-2 flex items-center gap-2 text-xs text-[#53685c]" role="status"><LoaderCircle size={14} className="animate-spin" />جارٍ فحص تنبيهات الهاتف</p>
      ) : (
        <>
          <p className="mt-1 text-xs leading-5 text-[#53685c]">
            {phone.configured
              ? 'تصل حتى عند إغلاق صفحة التطبيق. الصوت يتبع إعدادات تنبيهات الهاتف وعدم الإزعاج.'
              : 'يلزم استكمال إعداد تنبيهات الهاتف على الخادم قبل التفعيل.'}
          </p>
          {phone.configured && (
            <div className="mt-2 flex flex-wrap gap-2">
              <button type="button" disabled={phone.busy} onClick={() => void (phone.enabled ? phone.disable() : phone.enable())}
                className="btn btn-primary min-h-11 !px-3 !py-2 text-xs disabled:opacity-60" data-testid="button-phone-notifications" aria-pressed={phone.enabled}>
                {phone.busy ? <LoaderCircle size={16} className="animate-spin" /> : phone.enabled ? <BellOff size={16} /> : <BellRing size={16} />}
                {phone.enabled ? 'إيقاف تنبيهات هذا الجهاز' : 'تفعيل تنبيهات الهاتف'}
              </button>
              {phone.enabled && (
                <button type="button" disabled={phone.busy} onClick={() => void phone.test()} className="btn btn-soft min-h-11 !px-3 !py-2 text-xs" data-testid="button-test-phone-notification">
                  <Send size={14} />تنبيه تجريبي
                </button>
              )}
            </div>
          )}
        </>
      )}
      {phone.error && (
        <div role="alert" className="mt-2 text-xs leading-5 text-[#a64d40]">
          <p>{phone.error}</p>
          <button type="button" onClick={phone.retry} disabled={phone.busy} className="mt-1 min-h-10 font-bold underline" data-testid="button-retry-phone-notifications">إعادة الفحص</button>
        </div>
      )}
      {phone.notice && <p role="status" className="mt-2 text-xs leading-5 text-[#365e58]">{phone.notice}</p>}
    </div>
  );
}
