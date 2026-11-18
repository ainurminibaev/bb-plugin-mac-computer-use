import { defineRpcContract } from '@get-bb/plugin-sdk';
import { z } from 'zod';
import { machinePolicySchema } from './policy';

const toolName = z.string().regex(/^[a-z][a-z0-9_]{1,63}$/);

export const imageSchema = z.object({
  data: z.string(),
  mimeType: z.string(),
  width: z.number(),
  height: z.number(),
  originalWidth: z.number(),
  originalHeight: z.number(),
});

export const callResultSchema = z.object({
  ok: z.boolean(),
  exitCode: z.number(),
  text: z.string(),
  image: imageSchema.nullable(),
});

export const permissionsSchema = z.object({
  daemon: z.boolean(),
  accessibility: z.boolean(),
  screenRecording: z.boolean(),
});

export const appSchema = z.object({ pid: z.number(), bundleId: z.string().nullable(), name: z.string().nullable() });

/** RPC that BB's server sends to the bb host process on the target Mac. */
export const hostContract = defineRpcContract({
  info: {
    input: z.null(),
    output: z.object({ platform: z.string(), arch: z.string(), driver: z.string().nullable(), version: z.string().nullable() }),
  },
  call: {
    input: z.object({
      tool: toolName,
      args: z.string().max(200_000),
      /** Driver session label: snapshots and element tokens live inside one session. */
      session: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/).nullable(),
      wantImage: z.boolean(),
      maxImageWidth: z.number().int().min(160).max(4096),
    }),
    output: callResultSchema,
  },
  describe: {
    input: z.object({ tool: toolName.nullable() }),
    output: z.object({ text: z.string() }),
  },
  status: { input: z.null(), output: z.object({ text: z.string() }) },
  permissions: { input: z.null(), output: permissionsSchema },
  /** Opens the driver's permission guide on the Mac screen; the user flips the switches. */
  grant: { input: z.null(), output: z.object({ started: z.boolean() }) },
  /** Installs a verified CuaDriver release (sha256 + Developer ID team check). */
  install: {
    input: z.object({ version: z.string().regex(/^\d+\.\d+\.\d+$/), teamId: z.string().regex(/^[A-Z0-9]{10}$/) }),
    output: z.object({ ok: z.boolean(), log: z.string() }),
  },
  apps: { input: z.object({ pids: z.array(z.number().int().positive()).max(50) }), output: z.object({ apps: z.array(appSchema) }) },
});

/** RPC the settings screen calls on the BB server. */
export const machineViewSchema = z.object({
  id: z.string(),
  name: z.string(),
  connected: z.boolean(),
  platform: z.string().nullable(),
  driverVersion: z.string().nullable(),
  permissions: permissionsSchema.nullable(),
  error: z.string().nullable(),
  policy: machinePolicySchema,
});
export type MachineView = z.infer<typeof machineViewSchema>;

export const rpcContract = defineRpcContract({
  overview: { input: z.null(), output: z.object({ machines: z.array(machineViewSchema), latestDriver: z.string().nullable() }) },
  setPolicy: { input: z.object({ hostId: z.string(), policy: machinePolicySchema }), output: z.object({ ok: z.boolean() }) },
  check: {
    input: z.object({ hostId: z.string() }),
    output: z.object({ ok: z.boolean(), message: z.string(), image: z.object({ data: z.string(), mimeType: z.string() }).nullable() }),
  },
  install: { input: z.object({ hostId: z.string() }), output: z.object({ ok: z.boolean(), log: z.string() }) },
  grant: { input: z.object({ hostId: z.string() }), output: z.object({ started: z.boolean() }) },
  journal: {
    input: z.null(),
    output: z.object({ entries: z.array(z.object({ at: z.number(), machine: z.string(), threadId: z.string(), tool: z.string(), why: z.string(), result: z.string() })) }),
  },
});

export type CallResult = z.infer<typeof callResultSchema>;
