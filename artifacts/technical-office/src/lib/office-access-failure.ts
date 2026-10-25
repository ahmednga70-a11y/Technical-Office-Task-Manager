export type OfficeAccessFailure = {
  kind: 'invitation' | 'verification' | 'session' | 'conflict' | 'service';
  title: string;
  description: string;
  status?: number;
};

export function classifyOfficeAccessFailure(error: unknown): OfficeAccessFailure {
  const candidate = error && typeof error === 'object'
    ? error as { status?: unknown; data?: { error?: unknown; code?: unknown } }
    : undefined;
  const status = typeof candidate?.status === 'number' ? candidate.status : undefined;
  const data = candidate?.data;
  if (status === 403 && (
    data?.code === 'INVITATION_REQUIRED' ||
    data?.error === 'An active invitation for this verified email is required.'
  )) {
    return {
      kind: 'invitation', status,
      title: 'الدخول بدعوة فقط',
      description: 'الحساب مش مرتبط بمساحة المكتب. لو أنت المدير، تأكد إنك داخل بالبريد المخصص للإدارة. باقي الأعضاء يحتاجوا دعوة من المدير.',
    };
  }
  if (status === 403) {
    return {
      kind: 'verification', status,
      title: 'تعذّر تأكيد صلاحية الحساب',
      description: 'تأكد من توثيق البريد الأساسي للحساب، ثم أعد التحقق. لو استمرت المشكلة، راجع إعدادات الوصول مع مسؤول التطبيق.',
    };
  }
  if (status === 401) {
    return {
      kind: 'session', status,
      title: 'تعذّر تأكيد جلسة الدخول',
      description: 'سجّل الخروج وادخل مرة أخرى، ثم أعد المحاولة.',
    };
  }
  if (status === 409 && data?.code === 'OFFICE_IDENTITY_CONFLICT') {
    return {
      kind: 'conflict', status,
      title: 'يلزم مراجعة ربط الحساب',
      description: 'يوجد أكثر من سجل مرتبط بالبريد نفسه. يلزم مراجعة السجلات قبل الربط؛ لم يتم دمج الحسابات تلقائيًا.',
    };
  }
  return {
    kind: 'service', status,
    title: 'تعذّر ربط الحساب بالمكتب',
    description: 'حصل خطأ أثناء الاتصال بالخادم أو تجهيز بيانات المكتب. ده مش معناه إنك محتاج دعوة. أعد المحاولة، ولو استمر الخطأ يحتاج مسؤول التطبيق إلى مراجعة إعدادات الخادم وقاعدة البيانات.',
  };
}
