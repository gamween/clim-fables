// Copies the testnet desk, pool D and the token order from shared/deployments/robinhood-testnet.json (plan 03 Task 12)
// and the estimator from shared/params-fables.json into the workflow configs.
// Usage (from cre/risk-desk): bun scripts/sync-config.ts
import { readFileSync, writeFileSync } from 'node:fs'

const DEPLOYMENTS = process.env.DEPLOYMENTS ?? '../../shared/deployments/robinhood-testnet.json'
const PARAMS = process.env.PARAMS ?? '../../shared/params-fables.json'

type Json = Record<string, unknown>
const dep = JSON.parse(readFileSync(DEPLOYMENTS, 'utf8')) as Json
const params = JSON.parse(readFileSync(PARAMS, 'utf8')) as Json
const get = (o: Json, path: string): unknown =>
	path.split('.').reduce<unknown>((x, k) => (typeof x === 'object' && x !== null ? (x as Json)[k] : undefined), o)
const isAddr = (x: unknown): x is string => typeof x === 'string' && /^0x[0-9a-fA-F]{40}$/.test(x)

const desk = get(dep, 'riskDesk')
const poolId = get(dep, 'pools.D.poolId')
const token0IsEth = get(dep, 'pools.D.token0IsEth')
const estimator = get(params, 'sigmaEstimator')
if (!isAddr(desk) || typeof poolId !== 'string' || typeof token0IsEth !== 'boolean') {
	throw new Error(`${DEPLOYMENTS}: riskDesk, pools.D.poolId or pools.D.token0IsEth missing`)
}
if (typeof estimator !== 'string') throw new Error(`${PARAMS}: sigmaEstimator missing (plan 03 Task 2)`)

function update(file: string, f: (cfg: Json) => void): void {
	const cfg = JSON.parse(readFileSync(file, 'utf8')) as Json
	f(cfg)
	writeFileSync(file, `${JSON.stringify(cfg, null, 2)}\n`)
}

update('config.testnet.json', (cfg) => {
	cfg.deskAddress = desk
	cfg.sigmaEstimator = estimator
	const pool = cfg.pool as Json
	pool.poolId = poolId
	pool.token0IsEth = token0IsEth
	pool.decimals0 = token0IsEth ? 18 : 6
	pool.decimals1 = token0IsEth ? 6 : 18
})
for (const file of ['config.shadow.json', 'config.production.json']) {
	update(file, (cfg) => {
		cfg.sigmaEstimator = estimator
	})
}
console.log(`config.testnet.json: deskAddress=${desk} pool D=${poolId} token0IsEth=${token0IsEth} sigmaEstimator=${estimator}`)
console.log(`config.shadow.json, config.production.json: sigmaEstimator=${estimator}`)
