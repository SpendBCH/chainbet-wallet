let BITBOXCli = require('bitbox-cli/lib/bitbox-cli').default;
let BITBOX = new BITBOXCli();

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

class Network {
    // TODO: Merge all utxo method
    // TODO: Retry & throttling for network apis

    static async getUtxo(address) {
        // throttle calls to api
        await sleep(1000)

        return new Promise( (resolve, reject) => {
            BITBOX.Address.utxo(address).then((result) => { 
                let utxo = result.sort((a, b) => { return a.satoshis - b.satoshis })[result.length-1]
                resolve(utxo)
            }, (err) => { 
                console.log(err)
                reject(err)
            })
        })
    }

    static async getAllUtxo(address) {
        // throttle calls to api
        await sleep(1000)

        return new Promise( (resolve, reject) => {
            BITBOX.Address.utxo(address).then((result) => { 
                resolve(result)
            }, (err) => { 
                console.log(err)
                reject(err)
            })
        })
    }

    static async getHostSecret(txId) {
        // throttle calls to api
        await sleep(1000)

        return new Promise( (resolve, reject) => {
            BITBOX.Transaction.details(txId).then((result) => { 
                let asm = result.vin[0].scriptSig.asm
                let secret = Buffer(asm.split(" ")[3], 'hex')

                resolve(secret)
            }, (err) => { 
                console.log(err)
                reject(err)
            })
        })
    }

    static async sendRawAsync(hex) {
        // throttle calls to api
        await sleep(1000)

        return new Promise( (resolve, reject) => {
            BITBOX.RawTransactions.sendRawTransaction(hex).then((result) => { 
                console.log("txid: ", result)
                if (result.length != 64) { // TODO: Validate result is a txid
                    reject("Transaction failed: ", result)
                }
                else {
                    resolve(result)
                }
            }, (err) => { 
                console.log(err)
                reject(err)
            })
        })
    }
}

export default Network