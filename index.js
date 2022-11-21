import * as dotenv from "dotenv"
import { Ed25519Keypair, JsonRpcProvider, RawSigner } from '@mysten/sui.js'
import bip39 from 'bip39'
import axios from 'axios'
import HttpsProxyAgent from 'https-proxy-agent'
import fs from 'fs'
import consoleStamp from 'console-stamp'

dotenv.config()
consoleStamp(console, { format: ':date(HH:MM:ss)' })

const timeout = ms => new Promise(res => setTimeout(res, ms))
const provider = new JsonRpcProvider('https://fullnode.testnet.sui.io')

const DYNAMIC = process.env.CHANGE_IP
const THREADS = process.env.FAUCET_THREADS || 3

const nftArray = [[
    'Example NFT',
    'An NFT created by Sui Wallet',
    'ipfs://QmZPWWy5Si54R3d26toaqRiqvCH7HkGdXkxwUgCm2oKKM2?filename=img-sq-01.png',
], [
    'Example NFT',
    'An NFT created by the wallet Command Line Tool',
    'ipfs://bafkreibngqhl3gaa7daob4i2vccziay2jjlp435cf66vhono7nrvww53ty',
], [
    'Wizard Land',
    'Expanding The Magic Land',
    'https://gateway.pinata.cloud/ipfs/QmYfw8RbtdjPAF3LrC6S3wGVwWgn6QKq4LGS4HFS55adU2?w=800&h=450&c=crop',
], [
    'Ethos 2048 Game',
    'This player has unlocked the 2048 tile on Ethos 2048. They are a Winner!',
    'https://arweave.net/QW9doLmmWdQ-7t8GZ85HtY8yzutoir8lGEJP9zOPQqA',
]]

function parseFile(file) {
    let data = fs.readFileSync(file, "utf8")
    console.log('data', data)
    let array = data.split('\n').map(str => str.trim())
    const proxyRegex = /(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}):(\d{1,5})@(\w+):(\w+)/
    let proxyLists = []

    array.forEach(proxy => {
        if (proxy.match(proxyRegex)) {
            proxyLists.push({ "ip": `http://${proxy.split("@")[1]}@${proxy.split("@")[0]}`, "limited": false })
        }
    })

    return proxyLists
}

function saveMnemonic(mnemonic) {
    fs.appendFileSync("mnemonic.txt", `${mnemonic}\n`, "utf8")
}

async function requestSuiFromFaucet(proxy, recipient) {
    const axiosInstance = axios.create({
        httpsAgent: HttpsProxyAgent(proxy.ip),
        timeout: 1200000
    })

    if (DYNAMIC)
        console.log(`Requesting SUI from faucet with dynamic proxy, new IP: ${(await (axiosInstance.get('https://api64.ipify.org?format=json'))).data.ip}`)
    else
        console.log(`Requesting SUI from faucet with proxy ${proxy.ip.split("@")[1]}`)

    let res = await axiosInstance.post("https://faucet.testnet.sui.io/gas", {
        headers: { 'Content-Type': 'application/json' },
        data: JSON.stringify({ FixedAmountRequest: { recipient } }),
    }).catch(async err => {
        console.log('Faucet error:', err?.response?.statusText || err.code)

        if (err?.response?.status == 429) {
            proxy.limited = true
            console.log(`Proxy rate limited, need to wait ${err.response.headers['retry-after']} seconds`)
            await timeout(err.response.headers['retry-after'] * 1000)
            return requestSuiFromFaucet(proxy, recipient)
        }
    })

    res?.data && console.log(`Faucet request status: ${res?.statusText}`)

    return res?.data
}

async function mintNft(signer, args) {
    console.log(`Minting: ${args[1]}`)

    return await signer.executeMoveCall({
        packageObjectId: '0x2',
        module: 'devnet_nft',
        function: 'mint',
        typeArguments: [],
        arguments: args,
        gasBudget: 10000,
    })
}

async function mintBluemove(signer, collection, gas = 10000) {
    console.log(`Minting Bluemove ${collection}`)

    await signer.executeMoveCall({
        packageObjectId: '0x3c2468cdc0288983f099a52fc6f5b43e4ed0c959',
        module: 'bluemove_launchpad',
        function: 'mint_with_quantity',
        typeArguments: [],
        arguments: [collection, 1],
        gasBudget: gas,
    })
}

const mint = async (proxy) => {
    try {
        const mnemonic = bip39.generateMnemonic()
        const keypair = Ed25519Keypair.deriveKeypair(mnemonic)
        const address = keypair.getPublicKey().toSuiAddress()
        const j = address.slice(-4)

        let response = null
        for (let i = 0; i < THREADS; i++) {
            response = await requestSuiFromFaucet(proxy, address)
        }
        
        if (response) {
            console.log(`${j}: Sui Address: 0x${address}`)
            console.log(`${j}: Mnemonic: ${mnemonic}`)
            saveMnemonic(mnemonic)
            const signer = new RawSigner(keypair, provider)
            
            await mintBluemove(signer, '0x81e876200a657e173397f722aba3b6628c6d270') // Dragon

            for (let i = 0; i < nftArray.length; i++) {
                await mintNft(signer, nftArray[i])
            }

            console.log(`${j}: Result: https://explorer.sui.io/addresses/${address}?network=testnet`)
        }
        console.log("-".repeat(100))
    } catch (err) {
        console.log(err.message)
        await timeout(10000)
    }
}

const threads = 3;
(async () => {
    let proxyList = parseFile('proxy.txt')
    console.log(`Found ${proxyList.length} proxy`)

    if (proxyList.length > 0) {
        if (DYNAMIC) {
            for (;;) {
                const IP = await axios.get(DYNAMIC).then(r => r.data.rt).catch(e => 10)
                mint(proxyList[0])
                await timeout(IP * 1001)
            }
        } else {
            while (proxyList.every(proxy => !proxy.limited)) {
                for (let i = 0; i < proxyList.length; i++) {
                    await mint(proxyList[i])
                }
            }
        }
    } else console.log('No working proxy found, please make sure the proxy is in the correct format')
})()