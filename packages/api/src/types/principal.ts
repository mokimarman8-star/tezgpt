import type { PrincipalType } from 'tezgpt-data-provider';
import type { Types } from 'mongoose';

export interface ResolvedPrincipal {
  principalType: PrincipalType;
  principalId?: string | Types.ObjectId;
}
