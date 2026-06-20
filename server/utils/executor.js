import { spawn } from 'child_process';
import fs from 'fs';
import pathModule from 'path';
import crypto from 'crypto';
import { getRoomWorkspacePath } from './git.js';

// Enforce a maximum execution time of 5 seconds to prevent infinite loops from hanging the server
const EXECUTION_TIMEOUT_MS = 5000;

/**
 * Helper to spawn a process and return its output with a timeout
 */
function runProcess(command, args, options = {}) {
  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    let killed = false;
    let proc;

    try {
      proc = spawn(command, args, options);
    } catch (spawnError) {
      return resolve({
        code: -1,
        stdout: '',
        stderr: `Failed to start process '${command}': ${spawnError.message}`,
        errorType: 'SPAWN_ERROR'
      });
    }

    // Set timeout to kill process if it runs too long
    const timeout = setTimeout(() => {
      killed = true;
      try {
        if (process.platform === 'win32') {
          // On Windows, taskkill is needed to clean up child processes of the spawned shell
          spawn('taskkill', ['/pid', proc.pid, '/f', '/t']);
        } else {
          proc.kill('SIGKILL');
        }
      } catch (err) {
        console.error('[Executor] Error killing timed-out process:', err);
      }
    }, EXECUTION_TIMEOUT_MS);

    proc.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    proc.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    proc.on('error', (err) => {
      clearTimeout(timeout);
      if (err.code === 'ENOENT') {
        resolve({
          code: -1,
          stdout,
          stderr: `Command '${command}' not found on the local server.\n\nTo run this code, please ensure that the required compiler/interpreter is installed on your system and added to your environment PATH.`,
          errorType: 'ENOENT'
        });
      } else {
        resolve({
          code: -1,
          stdout,
          stderr: stderr || err.message,
          errorType: 'ERROR'
        });
      }
    });

    proc.on('close', (code) => {
      clearTimeout(timeout);
      if (killed) {
        resolve({
          code: -1,
          stdout,
          stderr: stdout + stderr + `\n[Time Limit Exceeded] Execution timed out after ${EXECUTION_TIMEOUT_MS / 1000}s.`,
          errorType: 'TIMEOUT'
        });
      } else {
        resolve({
          code,
          stdout,
          stderr
        });
      }
    });
  });
}

/**
 * Compile and run code locally in the room's workspace directory
 */
export async function executeLocalCode(code, language, roomId) {
  const workspacePath = getRoomWorkspacePath(roomId);
  
  // Ensure workspace exists
  if (!fs.existsSync(workspacePath)) {
    fs.mkdirSync(workspacePath, { recursive: true });
  }

  const uuid = crypto.randomBytes(8).toString('hex');
  const tempFilesToCleanup = [];
  const tempDirsToCleanup = [];

  try {
    // 1. Setup specific configurations per language
    let ext = '';
    let compileCmd = '';
    let compileArgs = [];
    let runCmd = '';
    let runArgs = [];
    let isCompiled = false;
    let javaClassName = 'Main';
    let javaTempDir = '';

    const binName = `temp_bin_${uuid}${process.platform === 'win32' ? '.exe' : ''}`;
    const fullBinPath = pathModule.join(workspacePath, binName);

    switch (language.toLowerCase()) {
      case 'javascript':
      case 'js':
        ext = 'js';
        runCmd = 'node';
        runArgs = [`temp_run_${uuid}.js`];
        break;

      case 'python':
      case 'py':
        ext = 'py';
        // Try 'python' on Windows and fallback or default to 'python3' on macOS/Linux
        runCmd = process.platform === 'win32' ? 'python' : 'python3';
        runArgs = [`temp_run_${uuid}.py`];
        break;

      case 'typescript':
      case 'ts':
        ext = 'ts';
        // Run via npx tsx
        runCmd = 'npx';
        runArgs = ['tsx', `temp_run_${uuid}.ts`];
        break;

      case 'go':
        ext = 'go';
        runCmd = 'go';
        runArgs = ['run', `temp_run_${uuid}.go`];
        break;

      case 'php':
        ext = 'php';
        runCmd = 'php';
        runArgs = [`temp_run_${uuid}.php`];
        break;

      case 'ruby':
      case 'rb':
        ext = 'rb';
        runCmd = 'ruby';
        runArgs = [`temp_run_${uuid}.rb`];
        break;

      case 'swift':
        ext = 'swift';
        runCmd = 'swift';
        runArgs = [`temp_run_${uuid}.swift`];
        break;

      case 'bash':
      case 'sh':
        ext = 'sh';
        runCmd = 'bash';
        runArgs = [`temp_run_${uuid}.sh`];
        break;

      case 'cpp':
      case 'c++':
        ext = 'cpp';
        isCompiled = true;
        compileCmd = 'g++';
        compileArgs = ['-O3', `temp_run_${uuid}.cpp`, '-o', binName];
        runCmd = process.platform === 'win32' ? binName : `./${binName}`;
        runArgs = [];
        break;

      case 'c':
        ext = 'c';
        isCompiled = true;
        compileCmd = 'gcc';
        compileArgs = ['-O3', `temp_run_${uuid}.c`, '-o', binName];
        runCmd = process.platform === 'win32' ? binName : `./${binName}`;
        runArgs = [];
        break;

      case 'rust':
      case 'rs':
        ext = 'rs';
        isCompiled = true;
        compileCmd = 'rustc';
        compileArgs = [`temp_run_${uuid}.rs`, '-o', binName];
        runCmd = process.platform === 'win32' ? binName : `./${binName}`;
        runArgs = [];
        break;

      case 'csharp':
      case 'cs':
        ext = 'cs';
        isCompiled = true;
        // On Windows csc is default, mono mcs is fallback
        compileCmd = 'csc';
        compileArgs = [`temp_run_${uuid}.cs`, `/out:${binName}`];
        runCmd = process.platform === 'win32' ? binName : `./${binName}`;
        runArgs = [];
        break;

      case 'java':
        // Extract public class name from code
        const classMatch = code.match(/public\s+class\s+([a-zA-Z0-9_$]+)/);
        javaClassName = classMatch ? classMatch[1] : 'Main';
        
        // Write to a temporary isolated subdirectory to avoid name conflicts with Main.class
        javaTempDir = `temp_java_${uuid}`;
        const absJavaTempDir = pathModule.join(workspacePath, javaTempDir);
        fs.mkdirSync(absJavaTempDir, { recursive: true });
        tempDirsToCleanup.push(absJavaTempDir);

        const javaFile = pathModule.join(javaTempDir, `${javaClassName}.java`);
        fs.writeFileSync(pathModule.join(workspacePath, javaFile), code, 'utf8');
        
        isCompiled = true;
        compileCmd = 'javac';
        compileArgs = [javaFile];
        runCmd = 'java';
        runArgs = ['-cp', javaTempDir, javaClassName];
        break;

      case 'sql':
        ext = 'sql';
        runCmd = 'sqlite3';
        runArgs = []; // Sqlite3 accepts input redirected or from arguments
        break;

      default:
        return {
          stdout: null,
          stderr: `Language "${language}" is not supported for local code execution.`,
          compile_output: null,
          status: { description: 'Unsupported Language' }
        };
    }

    // 2. Write code to file (except for Java which is written above)
    let srcFile = '';
    if (language.toLowerCase() !== 'java') {
      srcFile = `temp_run_${uuid}.${ext}`;
      fs.writeFileSync(pathModule.join(workspacePath, srcFile), code, 'utf8');
      tempFilesToCleanup.push(pathModule.join(workspacePath, srcFile));
    }

    // 3. Compile if necessary
    if (isCompiled) {
      console.log(`[Executor] Compiling ${language}: ${compileCmd} ${compileArgs.join(' ')}`);
      const compResult = await runProcess(compileCmd, compileArgs, { cwd: workspacePath });
      
      // If compiler wasn't found (ENOENT)
      if (compResult.errorType === 'ENOENT') {
        // For C#, let's try fallback to mono 'mcs' on macOS/Linux if csc fails
        if (language.toLowerCase() === 'csharp' && process.platform !== 'win32') {
          console.log(`[Executor] csc not found. Trying mcs fallback...`);
          compileCmd = 'mcs';
          compileArgs = [`temp_run_${uuid}.cs`, `-out:${binName}`];
          const fallbackCompResult = await runProcess(compileCmd, compileArgs, { cwd: workspacePath });
          if (fallbackCompResult.code !== 0) {
            return {
              stdout: null,
              stderr: fallbackCompResult.stderr,
              compile_output: fallbackCompResult.stderr,
              status: { description: 'Compilation Error' }
            };
          }
        } else {
          return {
            stdout: null,
            stderr: compResult.stderr,
            compile_output: null,
            status: { description: 'Compiler Not Found' }
          };
        }
      } else if (compResult.code !== 0) {
        return {
          stdout: null,
          stderr: compResult.stderr,
          compile_output: compResult.stderr,
          status: { description: 'Compilation Error' }
        };
      }

      if (language.toLowerCase() !== 'java') {
        tempFilesToCleanup.push(fullBinPath);
      }
    }

    // 4. Execute the code/binary
    console.log(`[Executor] Running ${language}: ${runCmd} ${runArgs.join(' ')}`);
    
    // For SQL, we need to pass input via stdin or execute in memory sqlite
    let execResult;
    if (language.toLowerCase() === 'sql') {
      // Execute sqlite3 with in-memory database and pipe SQL commands
      execResult = await new Promise((resolve) => {
        const proc = spawn('sqlite3', [], { cwd: workspacePath });
        let stdout = '';
        let stderr = '';
        let timeout = setTimeout(() => {
          proc.kill('SIGKILL');
        }, EXECUTION_TIMEOUT_MS);

        proc.stdout.on('data', (d) => stdout += d.toString());
        proc.stderr.on('data', (d) => stderr += d.toString());
        
        proc.on('error', (err) => {
          clearTimeout(timeout);
          if (err.code === 'ENOENT') {
            resolve({
              code: -1,
              stdout: '',
              stderr: `sqlite3 command not found on the local server.\n\nPlease install sqlite3 to run SQL commands locally.`,
              errorType: 'ENOENT'
            });
          } else {
            resolve({ code: -1, stdout, stderr: err.message });
          }
        });

        proc.on('close', (code) => {
          clearTimeout(timeout);
          resolve({ code, stdout, stderr });
        });

        // Write SQL commands and exit
        proc.stdin.write(code);
        proc.stdin.write('\n.exit\n');
        proc.stdin.end();
      });
    } else {
      execResult = await runProcess(runCmd, runArgs, { cwd: workspacePath });
    }

    // Handle python3 fallback on Linux/Mac if python was not found
    if (execResult.errorType === 'ENOENT' && language.toLowerCase() === 'python' && runCmd === 'python') {
      console.log(`[Executor] python not found. Trying python3 fallback...`);
      runCmd = 'python3';
      execResult = await runProcess(runCmd, runArgs, { cwd: workspacePath });
    }

    if (execResult.errorType === 'ENOENT' || (execResult.stderr && execResult.stderr.includes('Python was not found'))) {
      return {
        stdout: null,
        stderr: execResult.stderr,
        compile_output: null,
        status: { description: 'Interpreter Not Found' }
      };
    }

    return {
      stdout: execResult.stdout || null,
      stderr: execResult.stderr || null,
      compile_output: null,
      status: {
        description: execResult.code === 0 ? 'Accepted' : (execResult.errorType === 'TIMEOUT' ? 'Time Limit Exceeded' : 'Runtime Error')
      },
      time: '0.05', // Mock telemetry time
      memory: '1.2 MB'
    };

  } catch (err) {
    console.error('[Executor] Error executing code:', err);
    return {
      stdout: null,
      stderr: err.message,
      compile_output: null,
      status: { description: 'Server Error' }
    };
  } finally {
    // 5. Clean up temporary files
    for (const file of tempFilesToCleanup) {
      try {
        if (fs.existsSync(file)) {
          fs.unlinkSync(file);
        }
      } catch (cleanupErr) {
        console.error(`[Executor] Error cleaning up file ${file}:`, cleanupErr);
      }
    }

    // Clean up temporary directories (like Java build folder)
    for (const dir of tempDirsToCleanup) {
      try {
        if (fs.existsSync(dir)) {
          fs.rmSync(dir, { recursive: true, force: true });
        }
      } catch (cleanupErr) {
        console.error(`[Executor] Error cleaning up directory ${dir}:`, cleanupErr);
      }
    }
  }
}
