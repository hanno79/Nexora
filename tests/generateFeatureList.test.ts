import { describe, expect, it, vi } from 'vitest';
import { generateFeatureList } from '../server/services/llm/generateFeatureList';

function usage(total: number) {
  return {
    prompt_tokens: Math.floor(total / 2),
    completion_tokens: total - Math.floor(total / 2),
    total_tokens: total,
  };
}

function buildFeatureList(count: number, mainTaskName = 'Aufgabenverwaltung', taskSummary = 'Verwaltet Aufgaben endgueltig und testbar.'): string {
  const lines = ['Feature List:', '', `Main Task: ${mainTaskName}`, `Task Summary: ${taskSummary}`, ''];
  for (let i = 1; i <= count; i++) {
    const id = `F-${String(i).padStart(2, '0')}`;
    lines.push(`${id}: Feature ${i}`);
    lines.push(`Short description: Capability ${i}.`);
    lines.push('');
  }
  return lines.join('\n');
}

describe('generateFeatureList scope-aware targets', () => {
  it('accepts 3 features for tightly scoped requests without artificial retry', async () => {
    const client = {
      callWithFallback: vi.fn(async () => ({
        content: buildFeatureList(3),
        model: 'mock/small-scope',
        usage: usage(30),
      })),
    } as any;

    const result = await generateFeatureList(
      'Erstelle eine einfache To-do-App fuer eine Person.',
      'Die App soll Aufgaben erfassen, abhaken und loeschen.',
      client,
    );

    expect(client.callWithFallback).toHaveBeenCalledTimes(1);
    expect(result.retried).toBe(false);
    expect(String(client.callWithFallback.mock.calls[0][1] || '')).toMatch(/1.?2 Main Tasks with 3.?5 Subtasks total are often enough/);
    expect(String(client.callWithFallback.mock.calls[0][1] || '')).toContain('Output exactly 2 levels: Main Task -> Subtasks');
  });

  it('retries larger scopes below the relaxed default target of 5 features', async () => {
    const umfangreicherKontext = 'Mandanten, Rollen, Eskalationen, Audit-Logs, Genehmigungen und Reporting ueber mehrere Teams hinweg. '.repeat(6);
    const client = {
      callWithFallback: vi
        .fn()
        .mockResolvedValueOnce({
          content: buildFeatureList(4),
          model: 'mock/first-pass',
          usage: usage(40),
        })
        .mockResolvedValueOnce({
          content: buildFeatureList(5),
          model: 'mock/retry-pass',
          usage: usage(55),
        }),
    } as any;

    const result = await generateFeatureList(
      `Erstelle eine SaaS-Plattform fuer Teamplanung, Rollenverwaltung, Reports, Benachrichtigungen und API-Integrationen. ${umfangreicherKontext}`,
      `Die Plattform soll mehrere Teams, Workflows, Datenmodelle, Dashboards und operative Verwaltungsablaeufe unterstuetzen. ${umfangreicherKontext}`,
      client,
      {
        domainModel: `Teams, Benutzer, Rollen, Aufgaben, Kalender, Reportings, Integrationen, Audit-Ereignisse. ${umfangreicherKontext}`,
        systemBoundaries: `Web-App, Backend-Services, API-Schnittstellen, Benachrichtigungen und Administrationsbereich. ${umfangreicherKontext}`,
      },
    );

    expect(client.callWithFallback).toHaveBeenCalledTimes(2);
    expect(result.retried).toBe(true);
    expect(result.featureList).toContain('F-05: Feature 5');
    expect(String(client.callWithFallback.mock.calls[0][1] || '')).toMatch(/2.?4 Main Tasks with 5.?10 Subtasks total are often enough/);
  });

  it('classifies a short original user request as small scope even when vision and context are long', async () => {
    const ueberlangerKontext = 'Domain Model, System Boundaries, Betriebsdetails, Fehlerfaelle und Infrastrukturhinweise. '.repeat(20);
    const client = {
      callWithFallback: vi.fn(async () => ({
        content: buildFeatureList(3),
        model: 'mock/context-heavy',
        usage: usage(60),
      })),
    } as any;

    const result = await generateFeatureList(
      'Erstelle eine einfache To-do-App.',
      `Die Vision ist sehr lang. ${ueberlangerKontext}`,
      client,
      {
        domainModel: ueberlangerKontext,
        systemBoundaries: ueberlangerKontext,
      },
    );

    expect(result.retried).toBe(false);
    expect(client.callWithFallback).toHaveBeenCalledTimes(1);
    expect(String(client.callWithFallback.mock.calls[0][1] || '')).toMatch(/1.?2 Main Tasks with 3.?5 Subtasks total are often enough/);
  });
});