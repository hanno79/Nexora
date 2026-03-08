import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  initializeModelRegistry,
  getBestDirectProvider,
  resolveProvidersForModel,
  isOpenRouterFreeModel,
  isRegistryInitialized,
  getRegistrySize,
} from '../server/modelRegistry';

describe('Model-Provider Registry', () => {
  beforeAll(async () => {
    await initializeModelRegistry();
  });

  afterEach(() => {
    // Restore env vars
    delete process.env.NVIDIA_API_KEY;
    delete process.env.GROQ_API_KEY;
    delete process.env.CEREBRAS_API_KEY;
  });

  it('initializes successfully with model entries', () => {
    expect(isRegistryInitialized()).toBe(true);
    expect(getRegistrySize()).toBeGreaterThan(0);
  });

  // --- Regel 1: :free Modelle immer OpenRouter ---

  it('routes :free models exclusively to OpenRouter', () => {
    process.env.NVIDIA_API_KEY = 'nvapi-test';
    expect(resolveProvidersForModel('google/gemma-3-27b-it:free')).toEqual([]);
    expect(resolveProvidersForModel('meta-llama/llama-3.3-70b-instruct:free')).toEqual([]);
    expect(resolveProvidersForModel('nvidia/nemotron-3-nano-30b-a3b:free')).toEqual([]);
  });

  it('isOpenRouterFreeModel detects :free suffix correctly', () => {
    expect(isOpenRouterFreeModel('google/gemma-3-27b-it:free')).toBe(true);
    expect(isOpenRouterFreeModel('google/gemma-3-27b-it')).toBe(false);
    expect(isOpenRouterFreeModel('llama-3.3-70b-versatile')).toBe(false);
  });

  it('getBestDirectProvider returns null for :free models', () => {
    process.env.NVIDIA_API_KEY = 'nvapi-test';
    expect(getBestDirectProvider('google/gemma-3-27b-it:free')).toBeNull();
  });

  // --- Regel 2: OpenRouter-only Modelle (nicht bei Direct-Providern) ---

  it('routes google/gemini-2.5-flash to OpenRouter, not NVIDIA', () => {
    process.env.NVIDIA_API_KEY = 'nvapi-test';
    // gemini-2.5-flash existiert NICHT in der NVIDIA-Modellliste
    expect(resolveProvidersForModel('google/gemini-2.5-flash')).toEqual([]);
    expect(getBestDirectProvider('google/gemini-2.5-flash')).toBeNull();
  });

  it('routes anthropic/claude-sonnet-4 to OpenRouter (kein Direct-Provider)', () => {
    process.env.NVIDIA_API_KEY = 'nvapi-test';
    process.env.GROQ_API_KEY = 'gsk_test';
    expect(resolveProvidersForModel('anthropic/claude-sonnet-4')).toEqual([]);
    expect(getBestDirectProvider('anthropic/claude-sonnet-4')).toBeNull();
  });

  it('routes google/gemini-2.5-pro-preview to OpenRouter (kein Direct-Provider)', () => {
    process.env.NVIDIA_API_KEY = 'nvapi-test';
    expect(resolveProvidersForModel('google/gemini-2.5-pro-preview')).toEqual([]);
  });

  // --- Regel 3: Direct-Provider Modelle korrekt zuordnen ---

  it('routes meta/llama-3.1-8b-instruct to NVIDIA when key is present', () => {
    process.env.NVIDIA_API_KEY = 'nvapi-test';
    const providers = resolveProvidersForModel('meta/llama-3.1-8b-instruct');
    expect(providers).toContain('nvidia');
    expect(getBestDirectProvider('meta/llama-3.1-8b-instruct')).toBe('nvidia');
  });

  it('routes meta/llama-3.3-70b-instruct to NVIDIA when key is present', () => {
    process.env.NVIDIA_API_KEY = 'nvapi-test';
    expect(getBestDirectProvider('meta/llama-3.3-70b-instruct')).toBe('nvidia');
  });

  it('routes llama-3.3-70b-versatile to Groq when key is present', () => {
    process.env.GROQ_API_KEY = 'gsk_test';
    const providers = resolveProvidersForModel('llama-3.3-70b-versatile');
    expect(providers).toContain('groq');
    expect(getBestDirectProvider('llama-3.3-70b-versatile')).toBe('groq');
  });

  it('routes llama3.1-8b to Cerebras when key is present', () => {
    process.env.CEREBRAS_API_KEY = 'csk-test';
    const providers = resolveProvidersForModel('llama3.1-8b');
    expect(providers).toContain('cerebras');
    expect(getBestDirectProvider('llama3.1-8b')).toBe('cerebras');
  });

  it('routes llama-3.3-70b to Cerebras when key is present', () => {
    process.env.CEREBRAS_API_KEY = 'csk-test';
    const providers = resolveProvidersForModel('llama-3.3-70b');
    expect(providers).toContain('cerebras');
  });

  it('keeps qwen-3-235b-a22b-instruct-2507 on OpenRouter despite direct-provider registry noise', () => {
    process.env.CEREBRAS_API_KEY = 'csk-test';
    expect(resolveProvidersForModel('qwen-3-235b-a22b-instruct-2507')).toEqual([]);
    expect(getBestDirectProvider('qwen-3-235b-a22b-instruct-2507')).toBeNull();
  });

  // --- API Key Filterung ---

  it('returns empty when provider key is missing', () => {
    // Keine NVIDIA_API_KEY gesetzt
    expect(resolveProvidersForModel('meta/llama-3.3-70b-instruct')).toEqual([]);
    expect(getBestDirectProvider('meta/llama-3.3-70b-instruct')).toBeNull();
  });

  it('returns empty for Groq model when GROQ_API_KEY is missing', () => {
    expect(resolveProvidersForModel('llama-3.3-70b-versatile')).toEqual([]);
  });

  // --- Unbekannte Modelle ---

  it('returns empty for completely unknown model IDs', () => {
    process.env.NVIDIA_API_KEY = 'nvapi-test';
    process.env.GROQ_API_KEY = 'gsk_test';
    expect(resolveProvidersForModel('unknown/random-model-v42')).toEqual([]);
    expect(getBestDirectProvider('unknown/random-model-v42')).toBeNull();
  });
});
