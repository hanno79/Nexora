import { describe, it, expect } from 'vitest';
import {
  updateUserSchema,
  createTemplateSchema,
  updatePrdSchema,
  requestApprovalSchema,
  respondApprovalSchema,
} from '../server/schemas';

describe('updateUserSchema', () => {
  it('accepts valid data', () => {
    const result = updateUserSchema.parse({
      firstName: 'John',
      lastName: 'Doe',
      company: 'Acme',
      role: 'PM',
    });
    expect(result.firstName).toBe('John');
  });

  it('accepts empty object', () => {
    const result = updateUserSchema.parse({});
    expect(result).toBeDefined();
  });

  it('accepts null values', () => {
    const result = updateUserSchema.parse({ firstName: null });
    expect(result.firstName).toBeNull();
  });

  it('rejects firstName over 100 chars', () => {
    expect(() =>
      updateUserSchema.parse({ firstName: 'a'.repeat(101) })
    ).toThrow();
  });

  it('rejects company over 200 chars', () => {
    expect(() =>
      updateUserSchema.parse({ company: 'x'.repeat(201) })
    ).toThrow();
  });
});

describe('createTemplateSchema', () => {
  it('accepts valid template', () => {
    const result = createTemplateSchema.parse({
      name: 'My Template',
      content: '{"sections":[]}',
    });
    expect(result.name).toBe('My Template');
    expect(result.category).toBe('custom'); // default
  });

  it('rejects missing name', () => {
    expect(() =>
      createTemplateSchema.parse({ content: '{}' })
    ).toThrow();
  });

  it('rejects empty name', () => {
    expect(() =>
      createTemplateSchema.parse({ name: '', content: '{}' })
    ).toThrow();
  });

  it('rejects missing content', () => {
    expect(() =>
      createTemplateSchema.parse({ name: 'Test' })
    ).toThrow();
  });

  it('rejects name over 200 chars', () => {
    expect(() =>
      createTemplateSchema.parse({ name: 'a'.repeat(201), content: '{}' })
    ).toThrow();
  });

  it('accepts custom category', () => {
    const result = createTemplateSchema.parse({
      name: 'Test',
      content: '{}',
      category: 'epic',
    });
    expect(result.category).toBe('epic');
  });
});

describe('updatePrdSchema', () => {
  it('accepts valid update', () => {
    const result = updatePrdSchema.parse({
      title: 'Updated Title',
      status: 'draft',
    });
    expect(result.title).toBe('Updated Title');
  });

  it('accepts empty object', () => {
    const result = updatePrdSchema.parse({});
    expect(result).toBeDefined();
  });

  it('validates status enum', () => {
    expect(() =>
      updatePrdSchema.parse({ status: 'invalid-status' })
    ).toThrow();
  });

  it('accepts all valid statuses', () => {
    const statuses = ['draft', 'in-progress', 'review', 'pending-approval', 'approved', 'completed'];
    for (const status of statuses) {
      const result = updatePrdSchema.parse({ status });
      expect(result.status).toBe(status);
    }
  });

  it('allows passthrough of extra fields', () => {
    const result = updatePrdSchema.parse({
      title: 'Test',
      structuredContent: { features: [] },
      iterationLog: ['log1'],
    });
    expect((result as any).structuredContent).toBeDefined();
    expect((result as any).iterationLog).toBeDefined();
  });

  it('rejects title over 500 chars', () => {
    expect(() =>
      updatePrdSchema.parse({ title: 'a'.repeat(501) })
    ).toThrow();
  });
});

describe('requestApprovalSchema', () => {
  it('accepts valid reviewers', () => {
    const result = requestApprovalSchema.parse({
      reviewers: ['user-1', 'user-2'],
    });
    expect(result.reviewers).toHaveLength(2);
  });

  it('rejects empty reviewers array', () => {
    expect(() =>
      requestApprovalSchema.parse({ reviewers: [] })
    ).toThrow();
  });

  it('rejects more than 20 reviewers', () => {
    const reviewers = Array.from({ length: 21 }, (_, i) => `user-${i}`);
    expect(() =>
      requestApprovalSchema.parse({ reviewers })
    ).toThrow();
  });

  it('rejects missing reviewers', () => {
    expect(() =>
      requestApprovalSchema.parse({})
    ).toThrow();
  });
});

describe('respondApprovalSchema', () => {
  it('accepts true', () => {
    const result = respondApprovalSchema.parse({ approved: true });
    expect(result.approved).toBe(true);
  });

  it('accepts false', () => {
    const result = respondApprovalSchema.parse({ approved: false });
    expect(result.approved).toBe(false);
  });

  it('rejects non-boolean', () => {
    expect(() =>
      respondApprovalSchema.parse({ approved: 'yes' })
    ).toThrow();
  });

  it('rejects missing approved field', () => {
    expect(() =>
      respondApprovalSchema.parse({})
    ).toThrow();
  });
});
