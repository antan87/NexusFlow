import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import { extractAstSymbols, MonacoSymbolKind } from './symbolService.js';

describe('symbolService AST Extraction', () => {
  const cancelCaseControllerPath = 'C:/Users/anton.patron/Git/api_lasservice_container/API_LasService/Api/Controllers/Cases/CancelCase/CancelCaseController.cs';
  const caseEndpointsTestsPath = 'C:/Users/anton.patron/Git/api_lasservice_container/API_LasService/Api.Tests/Controllers/CaseEndpointsTests.cs';

  it('extracts symbols from CancelCaseController.cs with constructor and multiline method', async () => {
    let content: string;
    if (fs.existsSync(cancelCaseControllerPath)) {
      content = fs.readFileSync(cancelCaseControllerPath, 'utf8');
    } else {
      // Fallback snippet if path not found on runner
      content = `
namespace Hogia.LasService.Api.Controllers.Cases.CancelCase;

[ApiController]
public sealed class CancelCaseController : ControllerBase
{
    private readonly IResultDispatcher _dispatcher;

    public CancelCaseController(IResultDispatcher dispatcher)
    {
        _dispatcher = dispatcher;
    }

    [HttpPost("{caseId}/cancel")]
    public async Task<ActionResult<CreateCaseResponse>> Cancel(
        [FromRoute] string? caseId,
        [FromBody] CancelCaseRequest request,
        CancellationToken cancellationToken = default)
    {
        return Ok();
    }
}
`;
    }

    const symbols = await extractAstSymbols('CancelCaseController.cs', content);
    expect(symbols.length).toBeGreaterThanOrEqual(3);

    const classSym = symbols.find((s) => s.name === 'CancelCaseController' && s.kindLabel === 'class');
    expect(classSym).toBeDefined();
    expect(classSym?.kind).toBe(MonacoSymbolKind.Class);

    const ctorSym = symbols.find((s) => s.name === 'CancelCaseController' && s.kindLabel === 'constructor');
    expect(ctorSym).toBeDefined();
    expect(ctorSym?.kind).toBe(MonacoSymbolKind.Constructor);
    expect(ctorSym?.containerName).toBe('CancelCaseController');

    const methodSym = symbols.find((s) => s.name === 'Cancel' && s.kindLabel === 'method');
    expect(methodSym).toBeDefined();
    expect(methodSym?.kind).toBe(MonacoSymbolKind.Method);
    expect(methodSym?.containerName).toBe('CancelCaseController');
  });

  it('extracts symbols from CaseEndpointsTests.cs', async () => {
    let content: string;
    if (fs.existsSync(caseEndpointsTestsPath)) {
      content = fs.readFileSync(caseEndpointsTestsPath, 'utf8');
    } else {
      content = `
namespace Hogia.LasService.ApiTests.Controllers;

public sealed class CaseEndpointsTests : IDisposable
{
    public CaseEndpointsTests()
    {
    }

    [Fact]
    public async Task CancelCase_ValidRequest_ReturnsOk()
    {
    }

    public void Dispose()
    {
    }
}
`;
    }

    const symbols = await extractAstSymbols('CaseEndpointsTests.cs', content);
    expect(symbols.length).toBeGreaterThanOrEqual(3);

    const classSym = symbols.find((s) => s.name === 'CaseEndpointsTests' && s.kindLabel === 'class');
    expect(classSym).toBeDefined();

    const ctorSym = symbols.find((s) => s.name === 'CaseEndpointsTests' && s.kindLabel === 'constructor');
    expect(ctorSym).toBeDefined();
    expect(ctorSym?.kind).toBe(MonacoSymbolKind.Constructor);

    const disposeMethod = symbols.find((s) => s.name === 'Dispose' && s.kindLabel === 'method');
    expect(disposeMethod).toBeDefined();
  });

  it('extracts TypeScript classes, constructors, methods, and functions', async () => {
    const tsCode = `
export interface WorkerConfig {
  id: string;
}

export class TaskRunner {
  private config: WorkerConfig;

  constructor(config: WorkerConfig) {
    this.config = config;
  }

  public async execute(taskId: string): Promise<void> {
    console.log(taskId);
  }
}

export function helperFunction(): boolean {
  return true;
}

export const arrowRunner = async (x: number) => x * 2;
`;
    const symbols = await extractAstSymbols('runner.ts', tsCode);
    const names = symbols.map((s) => `${s.name}:${s.kindLabel}`);
    expect(names).toContain('WorkerConfig:interface');
    expect(names).toContain('id:property');
    expect(names).toContain('TaskRunner:class');
    expect(names).toContain('config:property');
    expect(names).toContain('constructor:constructor');
    expect(names).toContain('execute:method');
    expect(names).toContain('helperFunction:function');
    expect(names).toContain('arrowRunner:function');
  });

  it('extracts Python classes, constructors (__init__), and methods', async () => {
    const pyCode = `
class DataPipeline:
    def __init__(self, name: str):
        self.name = name

    def process(self, batch: list):
        pass

def standalone_task():
    pass
`;
    const symbols = await extractAstSymbols('pipeline.py', pyCode);
    const names = symbols.map((s) => `${s.name}:${s.kindLabel}`);
    expect(names).toContain('DataPipeline:class');
    expect(names).toContain('__init__:constructor');
    expect(names).toContain('process:method');
    expect(names).toContain('standalone_task:function');
  });

  it('extracts Go types, methods, and functions', async () => {
    const goCode = `
package service

type ServiceInterface interface {
    Run() error
}

type Server struct {
    port int
}

func (s *Server) Start() error {
    return nil
}

func NewServer(port int) *Server {
    return &Server{port: port}
}
`;
    const symbols = await extractAstSymbols('server.go', goCode);
    const names = symbols.map((s) => `${s.name}:${s.kindLabel}`);
    expect(names).toContain('ServiceInterface:interface');
    expect(names).toContain('Server:class');
    expect(names).toContain('port:property');
    expect(names).toContain('Start:method');
    expect(names).toContain('NewServer:function');
  });

  it('extracts C# 12 primary constructors on classes and records', async () => {
    const csCode = `
namespace Demo;
public class GreeterService(ILogger logger, string greeting)
{
    public void Greet() {}
}
`;
    const symbols = await extractAstSymbols('GreeterService.cs', csCode);
    const ctorSym = symbols.find((s) => s.name === 'GreeterService' && s.kindLabel === 'constructor');
    expect(ctorSym).toBeDefined();
    expect(ctorSym?.kind).toBe(MonacoSymbolKind.Constructor);
    expect(ctorSym?.containerName).toBe('GreeterService');
  });

  it('extracts Rust structs, enums, traits, struct fields, and impl methods', async () => {
    const rustCode = `
pub trait Repository {
    fn find_by_id(&self, id: &str) -> Option<String>;
}

pub struct SqlRepository {
    pub connection_str: String,
}

impl SqlRepository {
    pub fn new(conn: &str) -> Self {
        SqlRepository { connection_str: conn.to_string() }
    }
}

pub fn global_helper() {}
`;
    const symbols = await extractAstSymbols('repo.rs', rustCode);
    const names = symbols.map((s) => `${s.name}:${s.kindLabel}`);
    expect(names).toContain('Repository:interface');
    expect(names).toContain('SqlRepository:class');
    expect(names).toContain('connection_str:property');
    expect(names).toContain('new:method');
    expect(names).toContain('global_helper:function');
  });

  it('returns empty array for unsupported or empty files', async () => {
    expect(await extractAstSymbols('style.css', 'body { color: red; }')).toEqual([]);
    expect(await extractAstSymbols('empty.cs', '   ')).toEqual([]);
  });
});
