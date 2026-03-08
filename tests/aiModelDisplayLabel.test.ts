import React from 'react';
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { AiModelDisplayLabel } from '../client/src/components/settings/AiModelDisplayLabel';

describe('AiModelDisplayLabel', () => {
  it('renders provider and free badges while normalizing a trailing free suffix in the name', () => {
    const html = renderToStaticMarkup(
      React.createElement(AiModelDisplayLabel, {
        name: 'Google: Gemma 3 27B (free)',
        isFree: true,
        providerDisplayName: 'OpenRouter',
        providerColor: '#0f172a',
      }),
    );

    expect(html).toContain('Google: Gemma 3 27B');
    expect(html).not.toContain('Google: Gemma 3 27B (free)');
    expect(html).toContain('Free');
    expect(html).toContain('OpenRouter');
  });
});
