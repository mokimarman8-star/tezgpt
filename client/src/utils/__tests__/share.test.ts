jest.mock('tezgpt-data-provider', () => ({
  apiBaseUrl: jest.fn(),
}));

import { apiBaseUrl } from 'tezgpt-data-provider';
import { buildShareLinkUrl } from '../share';

describe('buildShareLinkUrl', () => {
  it('includes the base path for subdirectory deployments', () => {
    (apiBaseUrl as jest.Mock).mockReturnValue('/tezgpt');
    expect(buildShareLinkUrl('reW8SsFGQEH1b1uzSHe4I')).toBe(
      'http://localhost:3080/tezgpt/share/reW8SsFGQEH1b1uzSHe4I',
    );
  });

  it('works when base path is root', () => {
    (apiBaseUrl as jest.Mock).mockReturnValue('');
    expect(buildShareLinkUrl('reW8SsFGQEH1b1uzSHe4I')).toBe(
      'http://localhost:3080/share/reW8SsFGQEH1b1uzSHe4I',
    );
  });
});
