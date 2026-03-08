import { describe, expect, it } from 'vitest';
import { sanitizeConfiguredModel } from '../server/openrouterModelConfig';

describe('openrouterModelConfig', () => {
  it('sanitizes the invalid qwen-3-235b-a22b-instruct-2507 model id out of configured chains', () => {
    expect(sanitizeConfiguredModel('qwen-3-235b-a22b-instruct-2507')).toBeUndefined();
  });
});
