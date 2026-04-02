const { z } = require('zod');

const timeRegex = /^([01]\d|2[0-3]):[0-5]\d$/;
const dateRegex = /^\d{4}-\d{2}-\d{2}$/;

const isValidTimezone = (tz) => {
  try {
    Intl.DateTimeFormat(undefined, { timeZone: tz });
    return true;
  } catch {
    return false;
  }
};

const scheduleSchema = z.object({
  date: z
    .string()
    .regex(dateRegex, 'Date must be in YYYY-MM-DD format'),
  startTime: z
    .string()
    .regex(timeRegex, 'Start time must be in HH:mm format'),
  endTime: z
    .string()
    .regex(timeRegex, 'End time must be in HH:mm format'),
  sessionOrder: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  activity: z
    .string()
    .trim()
    .max(200, 'Activity cannot exceed 200 characters')
    .optional(),
  fee: z
    .number({ invalid_type_error: 'Fee must be a number' })
    .min(0, 'Fee must be non-negative'),
  mode: z.enum(['online', 'hybrid'], {
    errorMap: () => ({ message: 'Session mode must be "online" or "hybrid"' })
  }),
  streamMode: z.enum(['live_broadcast', 'interactive_class'], {
    errorMap: () => ({ message: 'Stream mode must be "live_broadcast" or "interactive_class"' })
  }).nullable().optional(),
  location: z.string().trim().nullable().optional(),
  timezone: z
    .string()
    .trim()
    .refine(isValidTimezone, 'Invalid IANA timezone string')
})
  .refine(
    (s) => s.startTime < s.endTime,
    { message: 'Start time must be before end time', path: ['endTime'] }
  )
  .refine(
    (s) => s.mode !== 'hybrid' || (s.location && s.location.length > 0),
    { message: 'Location is required for hybrid sessions', path: ['location'] }
  );

const createWorkshopSchema = z.object({
  workshopTitle: z
    .string()
    .trim()
    .min(5, 'Title must be at least 5 characters')
    .max(120, 'Title cannot exceed 120 characters'),
  workshopDescription: z
    .string()
    .trim()
    .min(1, 'Workshop description is required')
    .max(5000, 'Description cannot exceed 5000 characters'),
  expertDescription: z
    .string()
    .trim()
    .max(2000, 'Expert description cannot exceed 2000 characters')
    .optional(),

  threeHourPlan: z.object({
    hour1: z.object({ title: z.string().trim().min(1, 'Hour 1 title is required'), description: z.string().trim().min(1, 'Hour 1 description is required'), expertAllowed: z.boolean().optional(), instructorAllowed: z.boolean().optional() }),
    hour2: z.object({ title: z.string().trim().default('Hands On'), description: z.string().trim().min(1, 'Hour 2 description is required'), expertAllowed: z.boolean().optional(), instructorAllowed: z.boolean().optional() }),
    hour3: z.object({ title: z.string().trim().default('Project Discussion'), description: z.string().trim().min(1, 'Hour 3 description is required'), expertAllowed: z.boolean().optional(), instructorAllowed: z.boolean().optional() })
  }).optional(),
  schedules: z
    .array(scheduleSchema)
    .min(0, 'Schedules are optional during creation')
    .optional()
});

const updateWorkshopSchema = z.object({
  workshopTitle: z
    .string()
    .trim()
    .min(5, 'Title must be at least 5 characters')
    .max(120, 'Title cannot exceed 120 characters')
    .optional(),
  workshopDescription: z
    .string()
    .trim()
    .min(1, 'Workshop description is required')
    .max(5000, 'Description cannot exceed 5000 characters')
    .optional(),
  expertDescription: z
    .string()
    .trim()
    .max(2000, 'Expert description cannot exceed 2000 characters')
    .optional(),

  threeHourPlan: z.object({
    hour1: z.object({ title: z.string().trim().min(1, 'Hour 1 title is required'), description: z.string().trim().min(1, 'Hour 1 description is required'), expertAllowed: z.boolean().optional(), instructorAllowed: z.boolean().optional() }),
    hour2: z.object({ title: z.string().trim().default('Hands On'), description: z.string().trim().min(1, 'Hour 2 description is required'), expertAllowed: z.boolean().optional(), instructorAllowed: z.boolean().optional() }),
    hour3: z.object({ title: z.string().trim().default('Project Discussion'), description: z.string().trim().min(1, 'Hour 3 description is required'), expertAllowed: z.boolean().optional(), instructorAllowed: z.boolean().optional() })
  }).optional(),
  schedules: z
    .array(scheduleSchema)
    .min(0)
    .optional(),
  status: z.enum(['draft', 'published', 'cancelled'], {
    errorMap: () => ({ message: 'Status must be "draft", "published", or "cancelled"' })
  }).optional()
});

// Used for POST /workshops/:id/schedules — accepts 1 or more schedules in one request
const addSchedulesSchema = z.object({
  schedules: z.array(scheduleSchema).min(1, 'At least one schedule is required')
});

module.exports = { scheduleSchema, addSchedulesSchema, createWorkshopSchema, updateWorkshopSchema };
