const ChainbetWallet = require('./chainbet-wallet')
const chainbet = require('chainbet')
const chainfeed = require('chainfeed')
let BITBOXCli = require('bitbox-cli/lib/bitbox-cli').default;
let BITBOX = new BITBOXCli();

let alice = new ChainbetWallet({
    address: "",
    wif: "",
    pubKey: ""
})

let bob = new ChainbetWallet({
    address: "",
    wif: "",
    pubKey: ""
})

chainfeed.listen(function(res) {
    let txs
    if (res.block)
        txs = res.reduce((prev, cur) => [...prev, ...cur], [])
    else
        txs = res
    
    for(let tx of txs) {
        // Parse protocol from tx
        if (!tx.data || !tx.data[0].buf || !tx.data[0].buf.data) return
        let protocol = Buffer.from(tx.data[0].buf.data).toString('hex')

        // Only monitor BET protocol
        if (protocol != '00424554') return

        // Parse bet
        let buffers = tx.data.map((item) => Buffer.from(item.buf.data))
        let encoded = BITBOX.Script.encode(buffers)
        let asm = BITBOX.Script.toASM(encoded)
        let decodedBet = chainbet.decode(asm)
        
        // Accept alice's bet offers on bob's behalf
        if (decodedBet.phase == 1) {
            bob.acceptBet(decodedBet, tx.tx.hash)
        }
        // Broadcast bet to all users
        else {
            [alice, bob].forEach(user => user.processBetMessage(decodedBet, tx.tx.hash, tx.sender[0]))
        }
    }
})

// 
alice.announceBet(1000)