/**
 * @module utils/system-scanner
 * Detects local system specifications (RAM, GPU) and recommends the optimal local LLM size.
 */

import { execa } from 'execa';
import * as os from 'node:os';

export interface SystemSpecs {
  totalRamGb: number;
  gpuName: string;
  hasHardwareAcceleration: boolean;
  recommendedModel: string;
}

/**
 * Probes the local operating system to detect RAM and GPU specifications,
 * returning a recommended local LLM model name.
 */
export async function scanSystemSpecs(): Promise<SystemSpecs> {
  const totalRamGb = Math.round(os.totalmem() / (1024 * 1024 * 1024));
  let gpuName = 'Unknown/Integrated';
  let hasHardwareAcceleration = false;

  const platform = os.platform();

  try {
    if (platform === 'win32') {
      const { stdout } = await execa('powershell', ['-NoProfile', '-Command', 'Get-CimInstance Win32_VideoController | Select-Object -ExpandProperty Name'], { reject: false });
      if (stdout) {
        const lines = stdout.split('\n')
          .map(l => l.trim())
          .filter(l => l && l.toLowerCase() !== 'name');
        
        if (lines.length > 0) {
          gpuName = lines.join(', ');
          const lowerGpu = gpuName.toLowerCase();
          if (
            lowerGpu.includes('nvidia') || 
            lowerGpu.includes('radeon') || 
            lowerGpu.includes('geforce') || 
            lowerGpu.includes('rtx') || 
            lowerGpu.includes('gtx')
          ) {
            hasHardwareAcceleration = true;
          }
        }
      }
    } else if (platform === 'darwin') {
      const { stdout } = await execa('sysctl', ['-n', 'machdep.cpu.brand_string'], { reject: false });
      if (stdout && stdout.toLowerCase().includes('apple')) {
        gpuName = 'Apple Silicon (Integrated)';
        hasHardwareAcceleration = true;
      } else {
        const { stdout: spOut } = await execa('system_profiler', ['SPDisplaysDataType'], { reject: false });
        if (spOut) {
          gpuName = 'Intel Mac GPU';
          const lowerGpu = spOut.toLowerCase();
          if (lowerGpu.includes('amd') || lowerGpu.includes('radeon') || lowerGpu.includes('nvidia')) {
            hasHardwareAcceleration = true;
          }
        }
      }
    } else if (platform === 'linux') {
      const { stdout } = await execa('lspci', [], { reject: false });
      if (stdout) {
        const gpuLines = stdout.split('\n').filter(line => line.toLowerCase().includes('vga') || line.toLowerCase().includes('3d'));
        if (gpuLines.length > 0) {
          gpuName = gpuLines.map(line => line.split(':').pop()?.trim()).filter(Boolean).join(', ');
          const lowerGpu = gpuName.toLowerCase();
          if (lowerGpu.includes('nvidia') || lowerGpu.includes('amd') || lowerGpu.includes('radeon')) {
            hasHardwareAcceleration = true;
          }
        }
      }
    }
  } catch {
    // Ignore execution failures, fall back to default values
  }

  // Recommendation logic:
  // - RAM >= 12GB AND has dedicated GPU/Apple Silicon -> Recommend 7B
  // - RAM >= 16GB regardless of GPU -> Recommend 7B (can run fine on CPU)
  // - Otherwise -> Recommend 1.5B (fast and safe)
  let recommendedModel = 'qwen2.5-coder:1.5b';
  if ((totalRamGb >= 12 && hasHardwareAcceleration) || totalRamGb >= 16) {
    recommendedModel = 'qwen2.5-coder:7b';
  }

  return {
    totalRamGb,
    gpuName,
    hasHardwareAcceleration,
    recommendedModel,
  };
}
