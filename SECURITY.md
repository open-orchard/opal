# Security Policy

## Safety model

This tool is built to analyze hostile input safely:

- **The payload is never executed.** It runs the sample's own *decoder* logic
  in a sandboxed Web Worker and intercepts the sinks (`eval`, `do shell script`,
  network) — logging what the script *would* have done instead of doing it.
- **Nothing leaves your browser.** There is no backend; the page is static.
  Samples you paste are not uploaded, logged, or transmitted.
- **No network egress from the sandbox.** `fetch`/`XMLHttpRequest`/`WebSocket`/
  `importScripts` are stubbed inside the worker; a payload that tries to phone
  home produces an IOC, not a request.
- **Bounded execution.** A hard wall-clock timeout (`worker.terminate()`) stops
  runaway loops; recursion is depth-capped and de-duplicated.

## Treat decoded output as untrusted

The decoded layers and IOCs are *adversary-controlled strings*. Do not paste a
decoded command into a shell, open a decoded URL, or run a decoded payload
except in an environment you have set up for that purpose.

## Authorized use only

Use this only for defensive security, malware triage, and research on samples
you are authorized to analyze. You are responsible for complying with the laws
and policies that apply to you.

## Important: the Node runner is not a sandbox

The engine's `nodeRunner` exists for tests and as the v2-CLI baseline. It runs
in the Node global scope, where ambient globals (`process`, and through it
`child_process`/filesystem) are reachable and are **not** stubbed. Only the
browser Web Worker runner is safe for untrusted samples. Never feed untrusted
input to `nodeRunner`.
