import { z } from "zod";

export const expirationOptionSchema = z.enum(["1d", "7d", "30d", "90d", "never"]);
export type ExpirationOption = z.infer<typeof expirationOptionSchema>;

const shareLinkFields = {
  label: z.string().max(200).optional(),
  allowChat: z.boolean().default(false),
  allowDocs: z.boolean().default(false),
};

// A new link always picks an expiration explicitly (defaulting to "never"
// if the caller omits it entirely).
export const createShareLinkSchema = z.object({
  ...shareLinkFields,
  expiresIn: expirationOptionSchema.default("never"),
});

// Editing a link's label/chat/docs never touches its expiration unless
// `expiresIn` is actually present — omitting it means "leave the current
// expiry alone", not "reset to never" (see SharesService.update). That's
// why this isn't just createShareLinkSchema.partial(): everything else on
// a link is a full replace, only expiresIn is optional-means-unchanged.
export const updateShareLinkSchema = z.object({
  ...shareLinkFields,
  expiresIn: expirationOptionSchema.optional(),
});

export type CreateShareLinkInput = z.infer<typeof createShareLinkSchema>;
export type UpdateShareLinkInput = z.infer<typeof updateShareLinkSchema>;

export type { ProjectShareRow } from "../../db/schema";
