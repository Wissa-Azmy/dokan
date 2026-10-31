// Translations and text direction. Arabic is the default; each user can switch.
const dict = {
  ar: {
    appName: 'دكان',
    tagline: 'مخزونك وبيعك وفلوسك في مكان واحد',
    email: 'البريد الإلكتروني',
    password: 'كلمة المرور',
    yourName: 'اسمك',
    signIn: 'دخول',
    signUp: 'إنشاء حساب',
    signOut: 'خروج',
    haveAccount: 'عندك حساب؟ ادخل',
    noAccount: 'جديد هنا؟ أنشئ حساب',
    forgot: 'نسيت كلمة المرور؟',
    resetSent: 'بعتنالك رابط تغيير كلمة المرور على بريدك.',
    enterEmailFirst: 'اكتب بريدك الإلكتروني الأول.',
    passwordShort: 'كلمة المرور لازم تكون ٦ حروف على الأقل.',
    myShops: 'محلاتي',
    noShops: 'لسه ماعندكش محل. أنشئ محلك الأول، أو ادخل محل بدعوة.',
    createShop: 'محل جديد',
    joinShop: 'دخول بدعوة',
    joinSoon: 'الدخول بكود الدعوة جاي في الخطوة الجاية.',
    shopNameAr: 'اسم المحل بالعربي',
    shopNameEn: 'اسم المحل بالإنجليزي',
    firstBranch: 'اسم أول فرع',
    firstBranchHint: 'تقدر تضيف فروع ومخازن بعدين.',
    mainBranch: 'الفرع الرئيسي',
    create: 'إنشاء',
    cancel: 'إلغاء',
    save: 'حفظ',
    open: 'فتح',
    confirm: 'تأكيد',
    required: 'الحقل ده مطلوب.',
    roleOwner: 'مالك',
    roleManager: 'مدير',
    roleEmployee: 'موظف',
    preferences: 'تفضيلاتي',
    language: 'اللغة',
    digits: 'شكل الأرقام',
    digitsLatn: 'أرقام عادية (123)',
    digitsArab: 'أرقام عربية (١٢٣)',
    saved: 'اتحفظ.',
    shopCreated: 'المحل اتعمل.',
    switchShop: 'تغيير المحل',
    home: 'الرئيسية',
    comingNext: 'لوحة المحل والشاشات التانية جاية في الخطوات الجاية.',
    branches: 'الفروع والمخازن',
    offline: 'مفيش إنترنت — شغالين ومحفوظين على الجهاز، وهيتزامن لما النت يرجع.',
    loading: 'بنحمّل…',
    notConfigured: 'إعدادات Firebase لسه مش متكتبة في config.js.',
    errGeneric: 'حصلت مشكلة. جرّب تاني.',
    'auth/invalid-credential': 'البريد أو كلمة المرور غلط.',
    'auth/email-already-in-use': 'البريد ده عليه حساب بالفعل.',
    'auth/invalid-email': 'البريد الإلكتروني مش صحيح.',
    'auth/too-many-requests': 'محاولات كتير. استنى شوية وجرّب تاني.',
    'auth/network-request-failed': 'مفيش اتصال بالإنترنت.',
    'permission-denied': 'مش مسموحلك تعمل ده.',
  },
  en: {
    appName: 'Dokan',
    tagline: 'Your stock, sales and money in one place',
    email: 'Email',
    password: 'Password',
    yourName: 'Your name',
    signIn: 'Sign in',
    signUp: 'Create account',
    signOut: 'Sign out',
    haveAccount: 'Have an account? Sign in',
    noAccount: 'New here? Create an account',
    forgot: 'Forgot password?',
    resetSent: 'We sent a password reset link to your email.',
    enterEmailFirst: 'Enter your email first.',
    passwordShort: 'Password must be at least 6 characters.',
    myShops: 'My shops',
    noShops: "You don't have a shop yet. Create your first one, or join one with an invite.",
    createShop: 'New shop',
    joinShop: 'Join with invite',
    joinSoon: 'Joining with an invite code comes in the next step.',
    shopNameAr: 'Shop name (Arabic)',
    shopNameEn: 'Shop name (English)',
    firstBranch: 'First branch name',
    firstBranchHint: 'You can add more branches and warehouses later.',
    mainBranch: 'Main branch',
    create: 'Create',
    cancel: 'Cancel',
    save: 'Save',
    open: 'Open',
    confirm: 'Confirm',
    required: 'This field is required.',
    roleOwner: 'Owner',
    roleManager: 'Manager',
    roleEmployee: 'Employee',
    preferences: 'My preferences',
    language: 'Language',
    digits: 'Digits',
    digitsLatn: 'Western digits (123)',
    digitsArab: 'Arabic-Indic digits (١٢٣)',
    saved: 'Saved.',
    shopCreated: 'Shop created.',
    switchShop: 'Switch shop',
    home: 'Home',
    comingNext: 'The shop dashboard and other screens come in the next steps.',
    branches: 'Branches and warehouses',
    offline: 'Offline — your work is saved on this device and will sync when you are back online.',
    loading: 'Loading…',
    notConfigured: 'Firebase settings are not filled in config.js yet.',
    errGeneric: 'Something went wrong. Please try again.',
    'auth/invalid-credential': 'Wrong email or password.',
    'auth/email-already-in-use': 'This email already has an account.',
    'auth/invalid-email': 'This email address is not valid.',
    'auth/too-many-requests': 'Too many attempts. Wait a little and try again.',
    'auth/network-request-failed': 'No internet connection.',
    'permission-denied': "You're not allowed to do this.",
  },
};

let lang = localStorage.getItem('dokan.lang') || 'ar';

export function getLang() {
  return lang;
}

export function setLang(next) {
  lang = dict[next] ? next : 'ar';
  localStorage.setItem('dokan.lang', lang);
  document.documentElement.lang = lang;
  document.documentElement.dir = lang === 'ar' ? 'rtl' : 'ltr';
}

export function t(key, vars = {}) {
  const s = dict[lang][key] ?? dict.ar[key] ?? key;
  return s.replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? '');
}

// Friendly text for Firebase errors.
export function errorText(err) {
  const code = err?.code || '';
  if (code === 'auth/wrong-password' || code === 'auth/user-not-found') return t('auth/invalid-credential');
  return dict[lang][code] ? t(code) : t('errGeneric');
}

// Pick the name in the current language, falling back to the other one.
export function localName(obj, base = 'name') {
  const ar = obj?.[base + 'Ar'];
  const en = obj?.[base + 'En'];
  return (lang === 'ar' ? ar || en : en || ar) || '';
}

setLang(lang);
