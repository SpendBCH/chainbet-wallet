import cbContract  from './chainbet-contract'
import cbMessage  from './chainbet-message'

let BITBOXCli = require('bitbox-cli/lib/bitbox-cli').default;
let BITBOX = new BITBOXCli();
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

class Bet {
    constructor(txId, amount, type, targetAddress, isHost) {
        this.isHost = isHost
        this.phase = 1
        this.isActive = isHost ? true : false
        this.offers = []

        // Phase 1 data
        this.txId = txId
        this.amount = amount
        this.type = type
        this.targetAddress = targetAddress

        // Phase 2 data
        this.clientPubKey
        this.clientCommitment

        // Phase 3 data
        this.clientTxId
        this.hostEscrowTxId
        this.hostPubKey

        // Phase 4 data
        this.clientEscrowTxId
        this.clientSignature1
        this.clientSignature2

        // Phase 6 data
        this.clientSecret
    }
}

class ChainbetWallet {
    constructor(wif) {
        // TODO: Optional create new wallet

        let ecpair = BITBOX.ECPair.fromWIF(wif)
        let address = BITBOX.ECPair.toLegacyAddress(ecpair)
        let pubKey = Buffer(BITBOX.ECPair.toPublicKey(ecpair), 'hex')
        this.wallet = {
            address: address,
            pubKey: pubKey,
            wif: wif
        }
        console.log(this.wallet)
        this.bets = []
        this.listeners = []

        console.log("cons")
        this.monitorMessages()
        this.monitorActiveBets()
    }

    listen = (listener) => {
        this.listeners.push(listener)
    }

    // Publish list of bets to subscribers on change
    // TODO: Use observables for bets for local state
    publishBets = () => {
        this.listeners.forEach(listener => listener(this.bets))
    }

    monitorMessages = () => {
        let wallet = this
        let cfHandler = function(res) {
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

                console.log("bet message found")

                // Parse bet
                let buffers = tx.data.map((item) => Buffer.from(item.buf.data))
                let encoded = BITBOX.Script.encode(buffers)
                let asm = BITBOX.Script.toASM(encoded)
                let decodedBet = cbMessage.decode(asm)

                wallet.processBetMessage(decodedBet, tx.tx.hash, tx.sender[0])
            }
        }

        try { window.chainfeed.listen(cfHandler) }
        catch (ex) { this.monitorMessages() }
    }

    // Monitor active bets to claim wins or escape
    monitorActiveBets = () => {
        // Currently monitored in claimClientWin

        // Claim client win

        // Claim host win after timeout
    }

    announceBet = async (amount, targetAddress, type = 0x01) => {
        let hostSecret = BITBOX.Crypto.randomBytes(32)
        let hostCommitment = BITBOX.Crypto.hash160(hostSecret)

        let betTxId = await cbMessage.sendPhase1(this.wallet, type, amount, hostCommitment, targetAddress)
        let bet = new Bet(betTxId, amount, type, targetAddress, true)

        bet.hostSecret = hostSecret
        bet.hostCommitment = hostCommitment

        this.bets.push(bet)

        this.publishBets()
    }

    addAvailableBet = (betMessage, betTxId, peerAddress) => {
        let bet = new Bet(betTxId, betMessage.amount, betMessage.type,
            betMessage.targetAddress, false)
        bet.hostCommitment = Buffer(betMessage.hostCommitment, 'hex')
        bet.peerAddress = peerAddress

        this.bets.push(bet)
        this.publishBets()
    }

    acceptBet = async (betTxId) => {
        let bet = this.bets.find((b) => b.isActive == false && b.txId == betTxId)
        if (bet === undefined) return

        bet.clientSecret = BITBOX.Crypto.randomBytes(32)
        bet.clientCommitment = BITBOX.Crypto.hash160(bet.clientSecret)
        bet.isActive = true

        bet.clientTxId = await cbMessage.sendPhase2(this.wallet, betTxId, this.wallet.pubKey, bet.clientCommitment)

        this.publishBets()
    }

    acceptOffer = async (betTxId, clientTxId) => {
        let bet = this.bets.find((item) => item.txId == betTxId)
        if (bet === undefined) return

        let offer = bet.offers.find((item) => item.clientTxId == clientTxId)
        if (offer === undefined) return

        bet.clientPubKey = offer.clientPubKey
        bet.clientCommitment = offer.clientCommitment
        bet.clientTxId = offer.clientTxId
        bet.peerAddress = offer.peerAddress

        let pubKeys = [this.wallet.pubKey, bet.clientPubKey]
        bet.hostEscrowTxId = await cbContract.fundHostEscrow(this.wallet, pubKeys, bet.amount, bet.hostCommitment)

        await sleep(5000) // Wait for prev tx to propagate
        await cbMessage.sendPhase3(this.wallet, bet.txId, bet.clientTxId, bet.hostEscrowTxId, this.wallet.pubKey)
        bet.phase = 3
        this.publishBets()
    }

    processBetMessage = async (betMessage, txId, sender) => {
        if (sender == this.wallet.address) return;

        // Phase 1 Announced Bet
        if (betMessage.phase == 1) {
            this.addAvailableBet(betMessage, txId, sender)
        }

        // Verify this is an active bet the user is watching
        let bet = this.bets.find((b) => b.isActive == true && b.txId == betMessage.betTxId)
        if (bet === undefined) return

        // Verify sender address matches host/client for messages above phase 2
        if (betMessage.phase > 2 && sender != bet.peerAddress) return

        // New offer received for bet
        if (betMessage.phase == 2) {
            let offer = {
                clientPubKey: Buffer(betMessage.multisigPubKey, 'hex'),
                clientCommitment: Buffer(betMessage.clientCommitment, 'hex'),
                clientTxId: txId,
                peerAddress: sender
            }
            bet.phase = 2
            bet.offers.push(offer)

            this.publishBets()
            return
        }

        // TODO: Verify phase is in sync

        // TODO: Remove bets that have been accepted for a different user

        bet.phase = betMessage.phase

        // Phase 4 Bet client Funding
        if (betMessage.phase == 3) {
            // Verify participant txId -- host confirming bet client
            // TODO: Verify alice's escrow

            bet.hostEscrowTxId = betMessage.hostEscrowTxId
            bet.hostPubKey = Buffer(betMessage.hostPubKey, 'hex')

            let pubKeys = [bet.hostPubKey, this.wallet.pubKey]
            bet.clientEscrowTxId = await cbContract.fundClientEscrow(this.wallet, pubKeys, bet.amount)

            await sleep(5000) // Wait for prev tx to propagate
            await cbMessage.sendPhase4(this.wallet, pubKeys, bet.hostCommitment, bet.clientCommitment,
                bet.hostEscrowTxId, bet.clientEscrowTxId, bet.txId, bet.amount)

            this.publishBets()

            let winAmount = bet.amount * 2 - 940
            let res = await cbContract.claimWinClient(this.wallet, pubKeys, bet.hostCommitment, bet.clientCommitment,
                winAmount, bet.clientSecret)
            bet.won = res.won
            if (bet.won) bet.winAmount = winAmount
            else cbMessage.sendPhase6(this.wallet, bet.txId, bet.clientSecret)

            this.publishBets()
        }
        // Phase 5 Funding Transaction
        else if (betMessage.phase == 4) {

            bet.clientEscrowTxId = betMessage.clientEscrowTxId
            bet.clientSig1 = Buffer(betMessage.clientSig1, 'hex')
            bet.clientSig2 = Buffer(betMessage.clientSig2, 'hex')
            let pubKeys = [this.wallet.pubKey, bet.clientPubKey]
            bet.contractTxId = await cbContract.fundBetContract(this.wallet, pubKeys, bet.amount,
                bet.hostCommitment, bet.clientCommitment, bet.hostEscrowTxId, bet.clientEscrowTxId,
                bet.clientSig1, bet.clientSig2, bet.hostSecret)
            this.publishBets()
        }
        // Phase 6 Bet client Resignation
        else if (betMessage.phase == 6) {
            bet.clientSecret = Buffer(betMessage.clientSecret, 'hex')
            this.publishBets()
            bet.winAmount = bet.amount * 2 - 940

            let pubKeys = [this.wallet.pubKey, bet.clientPubKey]
            await cbContract.claimWinHostSecret(this.wallet, pubKeys, bet.hostCommitment, bet.clientCommitment,
                bet.contractTxId, bet.winAmount, bet.clientSecret)

            this.publishBets()
        }
    }
}

export default ChainbetWallet
