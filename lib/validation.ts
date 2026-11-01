import { z } from 'zod';

export const usernameSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9_.-]{3,30}$/, 'Username: 3-30 characters, letters, numbers, dot, dash or underscore');

export const passwordSchema = z.string().min(10, 'Use at least 10 characters').max(200);

export const loginSchema = z.object({
  identifier: z.string().trim().min(1).max(254),
  password: z.string().min(1).max(200),
});

export const forgotSchema = z.object({ identifier: z.string().trim().min(1).max(254) });

export const resetSchema = z.object({ password: passwordSchema });

export const setupSchema = z.discriminatedUnion('step', [
  z.object({ step: z.literal('check'), token: z.string().min(1) }),
  z.object({ step: z.literal('migrate'), token: z.string().min(1) }),
  z.object({
    step: z.literal('owner'),
    token: z.string().min(1),
    email: z.string().trim().email().max(254),
    username: usernameSchema,
    password: passwordSchema,
    seed: z.boolean().default(true),
  }),
]);

export const smtpSchema = z.object({
  host: z.string().trim().min(1).max(253),
  port: z.coerce.number().int().min(1).max(65535),
  secure: z.boolean(),
  user: z.string().trim().max(254).default(''),
  pass: z.string().max(500).optional(),
  from: z.string().trim().min(3).max(254),
});

export const sheetConfigSchema = z.object({
  url: z.string().trim().min(1).max(500),
  tab: z.string().trim().min(1).max(100).default('Expenses'),
});

export const googleKeySchema = z.object({
  json: z.string().min(20).max(10_000),
});

export const settingsPatchSchema = z
  .object({
    theme_mode: z.enum(['system', 'light', 'dark']),
    accent_hex: z.string().regex(/^#[0-9a-fA-F]{6}(:[a-z]{3,12})?$/),
    currency: z.string().trim().min(1).max(8),
    locale: z.string().trim().min(2).max(20),
    date_format: z.string().trim().min(2).max(30),
    week_start: z.number().int().min(1).max(7),
    timezone: z.string().trim().min(2).max(60),
    trash_retention_days: z.number().int().min(1).max(3650),
    remember_last: z.object({
      category: z.boolean(),
      bank: z.boolean(),
      payment_mode: z.boolean(),
      need_want: z.boolean(),
      income_source: z.boolean(),
    }),
  })
  .partial();

export const transactionSchema = z.object({
  id: z.string().uuid(),
  kind: z.enum(['expense', 'income']),
  name: z.string().trim().min(1).max(200),
  amount: z.number().positive().max(1_000_000_000),
  occurred_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  category_id: z.string().uuid().nullable().optional(),
  bank_id: z.string().uuid().nullable().optional(),
  payment_mode_id: z.string().uuid().nullable().optional(),
  income_source_id: z.string().uuid().nullable().optional(),
  need_want: z.enum(['need', 'want']).nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
});
