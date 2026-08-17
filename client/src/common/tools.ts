import type { AuthType } from 'tezgpt-data-provider';

export type ApiKeyFormData = {
  apiKey: string;
  authType?: string | AuthType;
};
