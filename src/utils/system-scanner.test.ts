import { describe, it, expect, vi, beforeEach } from 'vitest';
import { execa } from 'execa';
import * as os from 'node:os';
import { scanSystemSpecs } from './system-scanner.js';

vi.mock('execa');
vi.mock('node:os', async () => {
  const actual = await vi.importActual<typeof import('node:os')>('node:os');
  return {
    ...actual,
    totalmem: vi.fn(),
    platform: vi.fn(),
  };
});

describe('scanSystemSpecs', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should recommend 7b on windows with 16GB RAM even if no GPU detected', async () => {
    vi.mocked(os.totalmem).mockReturnValue(16 * 1024 * 1024 * 1024);
    vi.mocked(os.platform).mockReturnValue('win32');
    vi.mocked(execa).mockResolvedValue({ stdout: '' } as any);

    const specs = await scanSystemSpecs();

    expect(specs.totalRamGb).toBe(16);
    expect(specs.gpuName).toBe('Unknown/Integrated');
    expect(specs.hasHardwareAcceleration).toBe(false);
    expect(specs.recommendedModel).toBe('qwen2.5-coder:7b');
  });

  it('should recommend 1.5b on windows with 8GB RAM and no GPU', async () => {
    vi.mocked(os.totalmem).mockReturnValue(8 * 1024 * 1024 * 1024);
    vi.mocked(os.platform).mockReturnValue('win32');
    vi.mocked(execa).mockResolvedValue({ stdout: '' } as any);

    const specs = await scanSystemSpecs();

    expect(specs.totalRamGb).toBe(8);
    expect(specs.recommendedModel).toBe('qwen2.5-coder:1.5b');
  });

  it('should detect Nvidia GPU on Windows and recommend 7b with 12GB RAM', async () => {
    vi.mocked(os.totalmem).mockReturnValue(12 * 1024 * 1024 * 1024);
    vi.mocked(os.platform).mockReturnValue('win32');
    vi.mocked(execa).mockResolvedValue({
      stdout: 'NVIDIA GeForce RTX 4070 Laptop GPU\r\n'
    } as any);

    const specs = await scanSystemSpecs();

    expect(specs.totalRamGb).toBe(12);
    expect(specs.gpuName).toBe('NVIDIA GeForce RTX 4070 Laptop GPU');
    expect(specs.hasHardwareAcceleration).toBe(true);
    expect(specs.recommendedModel).toBe('qwen2.5-coder:7b');
  });

  it('should detect Apple Silicon on Darwin and recommend 7b with 12GB RAM', async () => {
    vi.mocked(os.totalmem).mockReturnValue(12 * 1024 * 1024 * 1024);
    vi.mocked(os.platform).mockReturnValue('darwin');
    vi.mocked(execa).mockResolvedValue({
      stdout: 'Apple M3 Max\n'
    } as any);

    const specs = await scanSystemSpecs();

    expect(specs.totalRamGb).toBe(12);
    expect(specs.gpuName).toBe('Apple Silicon (Integrated)');
    expect(specs.hasHardwareAcceleration).toBe(true);
    expect(specs.recommendedModel).toBe('qwen2.5-coder:7b');
  });

  it('should detect Linux GPU and recommend 7b with 12GB RAM', async () => {
    vi.mocked(os.totalmem).mockReturnValue(12 * 1024 * 1024 * 1024);
    vi.mocked(os.platform).mockReturnValue('linux');
    vi.mocked(execa).mockResolvedValue({
      stdout: '01:00.0 VGA compatible controller: NVIDIA Corporation AD104 [GeForce RTX 4070 Ti] (rev a1)\n'
    } as any);

    const specs = await scanSystemSpecs();

    expect(specs.totalRamGb).toBe(12);
    expect(specs.gpuName).toBe('NVIDIA Corporation AD104 [GeForce RTX 4070 Ti] (rev a1)');
    expect(specs.hasHardwareAcceleration).toBe(true);
    expect(specs.recommendedModel).toBe('qwen2.5-coder:7b');
  });
});
