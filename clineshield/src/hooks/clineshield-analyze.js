#!/usr/bin/env node
const { Project } = require('ts-morph');
const fs = require('fs');

/**
 * Analyzes structural changes between two TypeScript files
 * @param {string} beforePath - Path to the original file
 * @param {string} afterPath - Path to the modified file
 * @returns {Object} Analysis result with structuralChangePercent, deletedFunctions, deletedExports
 */
function analyzeStructuralChange(beforePath, afterPath) {
  try {
    // Validate file existence
    if (!fs.existsSync(beforePath)) {
      return {
        error: `File not found: ${beforePath}`,
        structuralChangePercent: 0,
        deletedFunctions: 0,
        deletedExports: 0
      };
    }

    if (!fs.existsSync(afterPath)) {
      return {
        error: `File not found: ${afterPath}`,
        structuralChangePercent: 0,
        deletedFunctions: 0,
        deletedExports: 0
      };
    }

    // Create ts-morph project
    const project = new Project({
      useInMemoryFileSystem: true,
      compilerOptions: {
        allowJs: true,
        checkJs: false
      }
    });

    try {
      const beforeSource = project.createSourceFile('before.ts', fs.readFileSync(beforePath, 'utf-8'));
      const afterSource = project.createSourceFile('after.ts', fs.readFileSync(afterPath, 'utf-8'));

      // Extract all function names from before file
      const beforeFunctions = new Set();

      // Get top-level function declarations
      beforeSource.getFunctions().forEach(fn => {
        const name = fn.getName();
        if (name) {
          beforeFunctions.add(name);
        }
      });

      // Get class methods (qualified with class name)
      beforeSource.getClasses().forEach(cls => {
        const className = cls.getName() || '<anonymous>';
        cls.getMethods().forEach(method => {
          const methodName = method.getName();
          beforeFunctions.add(`${className}.${methodName}`);
        });
      });

      // Get arrow functions and function expressions assigned to variables
      beforeSource.getVariableDeclarations().forEach(varDecl => {
        const initializer = varDecl.getInitializer();
        if (initializer) {
          const text = initializer.getText();
          // Check if it's a function (arrow or function expression)
          if (text.includes('=>') || text.startsWith('function')) {
            const name = varDecl.getName();
            if (name) {
              beforeFunctions.add(name);
            }
          }
        }
      });

      // Extract all function names from after file
      const afterFunctions = new Set();

      afterSource.getFunctions().forEach(fn => {
        const name = fn.getName();
        if (name) {
          afterFunctions.add(name);
        }
      });

      afterSource.getClasses().forEach(cls => {
        const className = cls.getName() || '<anonymous>';
        cls.getMethods().forEach(method => {
          const methodName = method.getName();
          afterFunctions.add(`${className}.${methodName}`);
        });
      });

      afterSource.getVariableDeclarations().forEach(varDecl => {
        const initializer = varDecl.getInitializer();
        if (initializer) {
          const text = initializer.getText();
          // Check if it's a function (arrow or function expression)
          if (text.includes('=>') || text.startsWith('function')) {
            const name = varDecl.getName();
            if (name) {
              afterFunctions.add(name);
            }
          }
        }
      });

      // Count deleted functions (exist in before but not in after)
      let deletedFunctions = 0;
      beforeFunctions.forEach(fnName => {
        if (!afterFunctions.has(fnName)) {
          deletedFunctions++;
        }
      });

      // Count added functions (exist in after but not in before)
      let addedFunctions = 0;
      afterFunctions.forEach(fnName => {
        if (!beforeFunctions.has(fnName)) {
          addedFunctions++;
        }
      });

      // Calculate structural change percentage
      // Change = (additions + deletions) / total functions
      const totalFunctions = beforeFunctions.size + afterFunctions.size;
      const structuralChangePercent = totalFunctions > 0
        ? Math.round(((addedFunctions + deletedFunctions) / totalFunctions) * 100)
        : 0;

      // Extract export names from before file
      const beforeExports = new Set();
      beforeSource.getExportedDeclarations().forEach((_declarations, exportName) => {
        beforeExports.add(exportName);
      });

      // Extract export names from after file
      const afterExports = new Set();
      afterSource.getExportedDeclarations().forEach((_declarations, exportName) => {
        afterExports.add(exportName);
      });

      // Count deleted exports (exist in before but not in after)
      let deletedExports = 0;
      beforeExports.forEach(exportName => {
        if (!afterExports.has(exportName)) {
          deletedExports++;
        }
      });

      return {
        structuralChangePercent,
        deletedFunctions,
        deletedExports
      };

    } catch (parseError) {
      return {
        error: `Parse error: ${parseError.message}`,
        structuralChangePercent: 0,
        deletedFunctions: 0,
        deletedExports: 0
      };
    }

  } catch (error) {
    return {
      error: error.message,
      structuralChangePercent: 0,
      deletedFunctions: 0,
      deletedExports: 0
    };
  }
}

// CLI interface
if (require.main === module) {
  const args = process.argv.slice(2);

  if (args.length < 2) {
    const result = {
      error: 'Usage: node clineshield-analyze.js <beforePath> <afterPath>',
      structuralChangePercent: 0,
      deletedFunctions: 0,
      deletedExports: 0
    };
    console.log(JSON.stringify(result, null, 2));
    process.exit(0);
  }

  const [beforePath, afterPath] = args;
  const result = analyzeStructuralChange(beforePath, afterPath);
  console.log(JSON.stringify(result, null, 2));
  process.exit(0);
}

module.exports = { analyzeStructuralChange };
