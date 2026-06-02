#!/usr/bin/env node

/**
 * Build script to generate config.js from .env
 * Run with: node build-config.js
 */

const fs = require('fs');
const path = require('path');

// Load .env file
const envPath = path.join(__dirname, '.env');
if (!fs.existsSync(envPath)) {
  console.error('❌ .env file not found');
  process.exit(1);
}

const envContent = fs.readFileSync(envPath, 'utf-8');
const env = {};

// Parse .env file
envContent.split('\n').forEach(line => {
  line = line.trim();
  if (!line || line.startsWith('#')) return;
  
  const [key, ...valueParts] = line.split('=');
  const value = valueParts.join('=').trim();
  env[key.trim()] = value;
});

// Generate config.js
const apiBaseUrl = env.NEUGPT_API_BASE_URL || 'http://localhost:8000';
const googleClientId = env.GOOGLE_CLIENT_ID || '';

const configContent = `window.NEURALWAYS_CONFIG = {
  API_BASE_URL: "${apiBaseUrl}",
  GOOGLE_CLIENT_ID: "${googleClientId}"
};
`;

const configPath = path.join(__dirname, 'config.js');
fs.writeFileSync(configPath, configContent, 'utf-8');

console.log('✅ config.js generated successfully');
console.log(`   API_BASE_URL: ${apiBaseUrl}`);
console.log(`   GOOGLE_CLIENT_ID: ${googleClientId ? googleClientId.substring(0, 20) + '...' : 'NOT SET'}`);
