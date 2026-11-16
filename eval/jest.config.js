// Run from clineshield/: npm run test:eval (uses clineshield's jest + ts-jest).
const path = require('path');
module.exports = {
  rootDir: __dirname,
  roots: ['<rootDir>/src'],
  testEnvironment: 'node',
  testMatch: ['**/__tests__/**/*.test.ts'],
  transform: {
    '^.+\\.ts$': [require.resolve('ts-jest', { paths: [path.join(__dirname, '../clineshield')] }), { tsconfig: path.join(__dirname, 'tsconfig.json') }],
  },
  moduleDirectories: ['node_modules', path.join(__dirname, '../clineshield/node_modules')],
};
