import './app.css';
import { mount } from 'svelte';
import App from './App.svelte';
import { CURRENT_BUCKET } from './lib/debug/bucket';
import { log, startBucket } from './lib/debug/sessionLog';
import { initUiScale } from './lib/ui/uiScale';

initUiScale();

startBucket(CURRENT_BUCKET);
log('boot', 'Application starting');

mount(App, { target: document.getElementById('app')! });

log('boot', 'Application mounted');