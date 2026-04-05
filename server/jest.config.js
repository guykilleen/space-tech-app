module.exports = {
  testEnvironment: 'node',
  setupFiles: ['<rootDir>/test-helpers/env.js'],
  globalSetup: '<rootDir>/test-helpers/globalSetup.js',
  globalTeardown: '<rootDir>/test-helpers/globalTeardown.js',
  testTimeout: 15000,
  verbose: true,
  forceExit: true,
};
