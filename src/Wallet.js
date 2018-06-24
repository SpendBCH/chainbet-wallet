import React, { Component } from 'react';
import ChainbetWallet from './chainbet-wallet/wallet';

class Wallet extends Component {
  constructor(props) {
    super(props)

    this.state = {
      wif: "",
    }
  }

  handleChangeWif = (event) => {
    this.setState({ wif: event.target.value })
  }

  handleSubmitWif = (event) => {
    event.preventDefault()

    let wallet = new ChainbetWallet(this.state.wif)
    this.props.setWallet(wallet)
  }
    
  renderWallet = () => {
    return (<div>
        { this.props.wallet.wallet.address }
        <button onClick={ () => this.props.announceBet() }>Announce new 2000 sat bet</button>
        </div>);
  }

  renderImportWif = () => {
    return (<form onSubmit={ this.handleSubmitWif }>
        <label>
        Import WIF:
        <input type="text" value={ this.state.wif } onChange={ this.handleChangeWif } />
        </label>
        <input type="submit" value="Import" />
    </form>);
  }

  render() {
    return (
      <div>
        <div>
            { this.props.wallet ? this.renderWallet() : this.renderImportWif() }
        </div>
      </div>
    );
  }
}

export default Wallet;
