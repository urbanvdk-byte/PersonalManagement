import {defineConfig} from '@playwright/test';

export default defineConfig({
 testDir:'./e2e-offline',
 timeout:45_000,
 expect:{timeout:20_000},
 use:{
  baseURL:'http://127.0.0.1:3000',
  httpCredentials:{username:'owner',password:'offline-test-password'},
  browserName:'chromium',headless:true,
  viewport:{width:1200,height:800}
 },
});
