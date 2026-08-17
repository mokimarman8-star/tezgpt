import { tezgpt } from 'tezgpt-data-provider';
import type { DynamicSettingProps } from 'tezgpt-data-provider';

type TezGPTKeys = keyof typeof tezgpt;

type TezGPTParams = {
  modelOptions: Omit<NonNullable<DynamicSettingProps['conversation']>, TezGPTKeys>;
  resendFiles: boolean;
  promptPrefix?: string | null;
  maxContextTokens?: number;
  fileTokenLimit?: number;
  modelLabel?: string | null;
};

/**
 * Separates TezGPT-specific parameters from model options
 * @param options - The combined options object
 */
export function extractTezGPTParams(
  options?: DynamicSettingProps['conversation'],
): TezGPTParams {
  if (!options) {
    return {
      modelOptions: {} as Omit<NonNullable<DynamicSettingProps['conversation']>, TezGPTKeys>,
      resendFiles: tezgpt.resendFiles.default as boolean,
    };
  }

  const modelOptions = { ...options };

  const resendFiles =
    (delete modelOptions.resendFiles, options.resendFiles) ??
    (tezgpt.resendFiles.default as boolean);
  const promptPrefix = (delete modelOptions.promptPrefix, options.promptPrefix);
  const maxContextTokens = (delete modelOptions.maxContextTokens, options.maxContextTokens);
  const fileTokenLimit = (delete modelOptions.fileTokenLimit, options.fileTokenLimit);
  const modelLabel = (delete modelOptions.modelLabel, options.modelLabel);

  return {
    modelOptions: modelOptions as Omit<
      NonNullable<DynamicSettingProps['conversation']>,
      TezGPTKeys
    >,
    maxContextTokens,
    fileTokenLimit,
    promptPrefix,
    resendFiles,
    modelLabel,
  };
}
