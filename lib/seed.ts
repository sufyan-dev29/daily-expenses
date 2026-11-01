import type { OptionKind } from '@/lib/types';

/** Optional starter lists (suggestions only). Everything here is editable or archivable in Settings. */
export const STARTER_OPTIONS: Record<OptionKind, string[]> = {
  category: [
    'Education', 'Utilities', 'Groceries', 'Housing', 'Personal Expense', 'Healthcare', 'Transportation', 'Personal Help',
  ],
  payment_mode: ['Bank Transfer', 'Credit Card', 'Cash', 'Mobile Payment'],
  bank: ['MCB Bank', 'JS Bank', 'Jazzcash', 'Opay', 'United Bank Limited', 'Digitt+', 'Bank Islami', 'Nayapay'],
  income_source: ['Salary', 'Business', 'Other'],
};

export const CATEGORY_ICONS: Record<string, string> = {
  education: 'school',
  utilities: 'bolt',
  groceries: 'shopping_cart',
  housing: 'home',
  personal: 'person',
  health: 'health_and_safety',
  transport: 'directions_car',
  fuel: 'local_gas_station',
  food: 'restaurant',
  help: 'volunteer_activism',
  salary: 'payments',
  business: 'storefront',
};

/** Keyword -> icon, checked in order. Matches whole-ish words in the name so "Kids' school fees" finds school. */
const KEYWORD_ICONS: [RegExp, string][] = [
  [/school|tuition|education|course|class|college|univers|fees?\b|book|study/i, 'school'],
  [/electric|utilit|power|bijli|wapda|k-?electric|lesco|bill/i, 'bolt'],
  [/gas|sui|petrol|fuel|diesel|pump/i, 'local_gas_station'],
  [/water|tanker/i, 'water_drop'],
  [/wifi|internet|broadband|fiber|ptcl|nayatel|stormfiber/i, 'wifi'],
  [/phone|mobile|load|recharge|jazz|zong|ufone|telenor|sim|data pack/i, 'smartphone'],
  [/grocer|supermarket|market|mart|sabzi|vegetable|fruit|ration|kiryana/i, 'shopping_cart'],
  [/restaurant|food|eat|dinner|lunch|breakfast|cafe|coffee|tea|snack|meal|dining|takeaway|delivery|foodpanda/i, 'restaurant'],
  [/rent|house|home|housing|mortgage|maintenance|repair|plumb|furnitur/i, 'home'],
  [/health|medical|doctor|hospital|clinic|pharmacy|medicine|dental|dentist|lab test|insurance/i, 'health_and_safety'],
  [/gym|fitness|workout|sport|yoga/i, 'fitness_center'],
  [/transport|taxi|uber|careem|bykea|rickshaw|bus|metro|train|parking|toll|commute|ride/i, 'directions_car'],
  [/car|vehicle|auto|mechanic|tyre|tire|service/i, 'directions_car'],
  [/flight|travel|trip|holiday|vacation|hotel|ticket|visa|tour/i, 'flight'],
  [/movie|cinema|netflix|entertain|game|gaming|fun|music|spotify|youtube|subscription/i, 'movie'],
  [/shop|cloth|dress|shoe|fashion|apparel|wear|outfit|garment|beauty|salon|barber|haircut|makeup/i, 'checkroom'],
  [/kid|child|baby|toy|daycare|diaper/i, 'child_care'],
  [/pet|cat|dog|vet\b|animal/i, 'pets'],
  [/gift|present|birthday|wedding|party|celebrat|eid/i, 'redeem'],
  [/charity|donat|zakat|sadaqa|help|support|volunteer|family|parents|mother|father/i, 'volunteer_activism'],
  [/tax|fbr|challan|government|fine|penalty|legal|lawyer|court/i, 'receipt_long'],
  [/loan|emi|installment|credit|debt|interest|bank charge|bank fee/i, 'credit_card'],
  [/saving|invest|stock|crypto|fund|deposit|gold|property|plot/i, 'savings'],
  [/salary|wage|pay\b|payroll|income|bonus|commission|stipend/i, 'payments'],
  [/business|client|invoice|freelance|project|sales|shop income|profit/i, 'storefront'],
  [/office|work|tool|equipment|software|hosting|domain|laptop|computer|gadget|electronic/i, 'devices'],
  [/hardware|build|fix|construction|paint|material|tools?/i, 'build'],
  [/personal|self|me\b|misc|other|general/i, 'person'],
];

/** Sensible icon from a name. Falls back to a plain tag when nothing matches. */
export function defaultIconFor(name: string): string {
  const n = name.toLowerCase().trim();
  if (!n) return 'sell';
  for (const [k, v] of Object.entries(CATEGORY_ICONS)) if (n.includes(k)) return v;
  for (const [re, icon] of KEYWORD_ICONS) if (re.test(n)) return icon;
  return 'sell';
}

/** Icons offered in every picker (adding or editing a category, bank, payment mode or source). */
export const ICON_CHOICES = [
  'sell', 'shopping_cart', 'restaurant', 'local_cafe', 'home', 'bolt', 'water_drop', 'wifi', 'smartphone', 'school',
  'health_and_safety', 'medication', 'fitness_center', 'directions_car', 'local_gas_station', 'directions_bus', 'flight', 'hotel',
  'movie', 'sports_esports', 'music_note', 'checkroom', 'child_care', 'pets', 'redeem', 'volunteer_activism',
  'receipt_long', 'credit_card', 'account_balance', 'wallet', 'payments', 'savings', 'storefront', 'work',
  'devices', 'build', 'handyman', 'person', 'groups', 'swap_horiz', 'favorite', 'star',
];

const MODE_ICONS: [RegExp, string][] = [
  [/credit|debit|card|visa|master/i, 'credit_card'],
  [/cash/i, 'payments'],
  [/mobile|wallet|jazz|easypaisa|nayapay|sada|raast|upi/i, 'smartphone'],
  [/cheque|check/i, 'receipt_long'],
  [/transfer|ibft|bank|wire|online/i, 'account_balance'],
];

/** Icon for any option: the one the owner picked, else a sensible default for its kind. */
export function iconForOption(kind: OptionKind, name: string, icon: string | null | undefined): string {
  if (icon) return icon;
  if (kind === 'bank') return 'account_balance';
  if (kind === 'payment_mode') return MODE_ICONS.find(([re]) => re.test(name))?.[1] ?? 'wallet';
  return defaultIconFor(name);
}
