/**
 * Public-site media read. Same backend factory as the CRM: R2 when the
 * four `R2_*` variables are set, local disk otherwise. The key scheme is
 * identical, so a photograph the office uploaded is the one this host serves.
 */

import { mediaBackend } from '@forecourt/media';

export const readPublicMedia = (key: string): Promise<Buffer | null> =>
  mediaBackend().get(key);
