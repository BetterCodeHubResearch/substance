import Component from './Component'

export default class ToolPanel extends Component {

  didMount() {
    this.context.state.observe(['commandStates'], this._onCommandStatesChanged, this)
  }

  dispose() {
    this.context.state.off(this)
  }

  render($$) { // eslint-disable-line
    throw new Error('This method is abstract')
  }

  /*
    Defines the components used to render certain entry types

    Override to customize.
  */
  getEntryTypeComponents() {
    return {
      'tool-group': this.getComponent('tool-group'),
      'tool-dropdown': this.getComponent('tool-dropdown')
    }
  }

  renderEntries($$) {
    let els = []
    this.props.toolPanel.forEach((entry) => {
      let entryTypeComponents = this.getEntryTypeComponents()
      let ComponentClass = entryTypeComponents[entry.type]
      if (!ComponentClass) throw new Error('Toolpanel entry type not found')
      let props = Object.assign({}, entry, { theme: this.getTheme() })
      els.push(
        $$(ComponentClass, props).ref(entry.name)
      )
    })
    return els
  }

  hasEnabledTools() {
    let entriesContainer = this.refs.entriesContainer
    let entries = entriesContainer.childNodes
    let hasEnabledTools = false
    entries.forEach((entry) => {
      if (entry.hasEnabledTools()) {
        hasEnabledTools = true
      }
    })
    return hasEnabledTools
  }

  getActiveToolGroupNames() {
    throw new Error('Abstract method')
  }

  showDisabled() {
    return false
  }

  /*
    Override if you just want to use a different style
  */
  getToolStyle() {
    throw new Error('Abstract method')
  }

  getTheme() {
    return this.props.theme || 'dark'
  }

  _onCommandStatesChanged() {
    this.rerender()
  }

}
