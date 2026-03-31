const { z } = require('zod');

const timeFormatRegex = /^([01]\d|2[0-3]):[0-5]\d$/;

const pricingSchema = z.object({
  type: z.enum(['Free', 'Share', 'Fixed']).default('Free'),
  amount: z.number().nonnegative().default(0),
  unit: z.enum(['Hourly', 'Session']).default('Hourly')
});

const hourlySlotZodSchema = z.object({
  time: z.string().regex(/^\d{2}:\d{2}-\d{2}:\d{2}$/, 'Slot time must be in HH:mm-HH:mm format'),
  status: z.enum(['Available', 'Booked', 'Maintenance', 'Closed']).default('Closed'),
  pricing: pricingSchema.optional().default({ type: 'Free', amount: 0, unit: 'Hourly' })
});

const availabilityScheduleSchema = z.object({
  day: z.enum(['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']),
  startTime: z.string().regex(timeFormatRegex, 'Start time must be in HH:mm format').optional(),
  endTime: z.string().regex(timeFormatRegex, 'End time must be in HH:mm format').optional(),
  slots: z.array(hourlySlotZodSchema).optional(),
  status: z.enum(['Available', 'Booked', 'Maintenance', 'Closed']).default('Available'),
  pricing: pricingSchema.optional().default({ type: 'Free', amount: 0 }),
  notes: z.string().optional()
}).refine(data => {
  if (data.startTime && data.endTime) {
    return data.startTime < data.endTime;
  }
  return true;
}, {
  message: 'End time must be after start time',
  path: ['endTime']
});


const addressSchema = z.object({
  addressLine1: z.string().trim().max(200).optional(),
  addressLine2: z.string().trim().max(200).optional(),
  landmark: z.string().trim().max(200).optional(),
  city: z.string().trim().max(100).optional(),
  district: z.string().trim().max(100).optional(),
  state: z.string().trim().max(100).optional(),
  country: z.string().trim().max(100).default('India'),
  pincode: z.string().trim().regex(/^[0-9]{6}$/, 'Invalid pincode').optional()
});

const locationSchema = z.object({
  type: z.enum(['Point']).default('Point'),
  coordinates: z.array(z.number()).length(2).default([0, 0])
});

const classroomSchema = z.object({
  name: z.string().trim().min(1, 'Name is required'),
  id: z.string().optional(), // id will be generated if not provided, or kept for legacy
  capacity: z.number().int().positive('Capacity must be positive'),
  length: z.number().positive().optional(),
  width: z.number().positive().optional(),
  area: z.number().positive().optional(),
  type: z.string().optional(),
  technology: z.array(z.string()).optional(),
  furniture: z.array(z.string()).optional(),
  lighting: z.array(z.string()).optional(),
  ventilation: z.array(z.string()).optional(),
  specializedEquipment: z.string().optional(),
  accessibility: z.array(z.string()).optional(),
  primaryUsage: z.string().optional(),
  availabilitySchedule: z.array(availabilityScheduleSchema).optional()
});

const computerLabSchema = z.object({
  name: z.string().trim().min(1, 'Name is required'),
  id: z.string().optional(),
  workstations: z.number().int().nonnegative('Workstations cannot be negative'),
  capacity: z.number().int().positive('Capacity must be positive'),
  softwareAvailable: z.array(z.string()).optional().default([]),
  internetSpeed: z.string().optional(),
  availabilitySchedule: z.array(availabilityScheduleSchema).optional()
});

const facilitySchema = z.object({
  name: z.string().trim().min(1, 'Name is required'),
  id: z.string().optional(),
  type: z.string().min(1, 'Facility type is required'),
  capacity: z.number().int().nonnegative().optional(),
  dimensions: z.string().optional(),
  soundSystem: z.boolean().default(false),
  lightingSystem: z.boolean().default(false),
  projectorScreen: z.boolean().default(false),
  availabilitySchedule: z.array(availabilityScheduleSchema).optional()
});

const infrastructureSchema = z.object({
  title: z.string().trim().min(1, 'Infrastructure title is required'),
  generalInfo: z.object({
    schoolName: z.string().min(1, 'School name is required'),
    address: addressSchema,
    location: locationSchema.optional(),
    contactName: z.string().min(1, 'Contact name is required'),
    contactEmail: z.string().email('Invalid contact email'),
    contactPhone: z.string().min(1, 'Contact phone is required'),
    timeZone: z.string().min(1, 'Time zone is required')
  }),
  classrooms: z.array(classroomSchema).optional().default([]),
  computerLabs: z.array(computerLabSchema).optional().default([]),
  otherFacilities: z.array(facilitySchema).optional().default([])
});

// Granular Update Schemas (make most fields optional for updates)
const classroomUpdateSchema = classroomSchema.partial();
const computerLabUpdateSchema = computerLabSchema.partial();
const facilityUpdateSchema = facilitySchema.partial();

const infrastructureUpdateSchema = z.object({
  title: z.string().trim().min(1).optional(),
  generalInfo: infrastructureSchema.shape.generalInfo.unwrap ? 
    infrastructureSchema.shape.generalInfo.unwrap().partial().optional() : 
    infrastructureSchema.shape.generalInfo.partial().optional(),
  classrooms: z.array(classroomSchema).optional(),
  computerLabs: z.array(computerLabSchema).optional(),
  otherFacilities: z.array(facilitySchema).optional()
});

module.exports = {
  infrastructureSchema,
  classroomSchema,
  classroomUpdateSchema,
  computerLabSchema,
  computerLabUpdateSchema,
  facilitySchema,
  facilityUpdateSchema,
  infrastructureUpdateSchema
};
