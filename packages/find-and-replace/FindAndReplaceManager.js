import { Marker } from '../../model'

class FindAndReplaceManager {

  constructor(context) {
    if (!context.editorSession) {
      throw new Error('EditorSession required.')
    }

    this.editorSession = context.editorSession
    this.editorSession.onRender('document', this._onDocumentChanged, this)

    this.doc = this.editorSession.getDocument()
    this.context = Object.assign({}, context, {
      // for convenienve we provide access to the doc directly
      doc: this.doc
    })

    this._state = {
      disabled: true,
      findString: '',
      replaceString: '',
      // Consists a sequence of property selections
      matches: {},
      matchedNodes: [],
      selectedMatch: undefined
    }

    // Set to indicate the desire to scroll to the selected match
    this._requestLookupMatch = false
    // Set to indicate the desire to focus and select the search string
    this._requestFocusSearchString = false
  }

  dispose() {
    this.editorSession.off(this)
  }

  /*
    NOTE: We remember findString and replaceString for the next search action
  */
  _resetState() {
    this._state.disabled = true
    this._state.matches = {}
    this._state.selectedMatch = undefined
  }

  /*
    Derive command state for FindAndReplaceTool
  */
  getCommandState() {
    let state = this._state
    let commandState = {
      disabled: state.disabled,
      findString: state.findString,
      replaceString: state.replaceString,
      // Used to display '4 of 10' etc.
      totalMatches: state.matches.length,
      selectedMatch: state.selectedMatch + 1
    }
    return commandState
  }

  enable() {
    this._state.disabled = false
    this._requestFocusSearchString = true
    // Attempts to start a find immediately
    this.startFind(this._state.findString)
  }

  disable() {
    this._state.disabled = true
    this._resetState()
    this._propagateUpdate()
  }

  _onDocumentChanged() {
    if (!this._state.disabled) {
      this._computeMatches()
      this._state.selectedMatch = 0
      this._updateMarkers()
    }
  }

  /*
    Start find and replace workflow
  */
  startFind(findString) {
    this._state.findString = findString
    this._computeMatches()
    let closestMatch = [0, 0] //this._getClosestMatch()
    this._state.selectedMatch = closestMatch //closestMatch > 0 ? closestMatch : 0
    this._requestLookupMatch = true
    if(this._state.matchedNodes.length > 0) {
      this._setSelection()
      this._propagateUpdate()
    }
  }

  setReplaceString(replaceString) {
    // NOTE: We don't trigger any updates here
    this._state.replaceString = replaceString
  }

  /*
    Find next match.
  */
  findNext() {
    let index = this._state.selectedMatch
    let totalMatches = this._state.matches.length
    if (totalMatches === 0) return
    this._state.selectedMatch = (index + 1) % totalMatches
    this._requestLookupMatch = true
    this._setSelection()
    this._propagateUpdate()
  }

  /*
    Find previous match
  */
  findPrevious() {
    let index = this._state.selectedMatch
    let totalMatches = this._state.matches.length
    if (totalMatches === 0) return
    this._state.selectedMatch = index > 0 ? index - 1 : totalMatches - 1
    this._requestLookupMatch = true
    this._setSelection()
    this._propagateUpdate()
  }

  _setSelection() {
    let matchedNodes = this._state.matchedNodes
    let selectedMatch = this._state.selectedMatch
    let nodeIndex = selectedMatch[0]
    let matchIndex = selectedMatch[1]
    let matchedNode = matchedNodes[nodeIndex]
    let match = this._state.matches[matchedNode]
    let coord = match.matches[matchIndex]
    if (!match) return
    // NOTE: We need to make sure no additional flow is triggered when
    // setting the selection. We trigger a flow at the very end (_propagateUpdate)
    let sel = {
      type: 'property',
      path: match.path,
      startOffset: coord.start,
      endOffset: coord.end,
      surfaceId: match.containerId,
      containerId: match.containerId
    }
    this.editorSession.setSelection(sel, 'skipFlow')
  }

  /*
    Replace next occurence
  */
  replaceNext() {
    let index = this._state.selectedMatch
    let match = this._state.matches[index]
    let totalMatches = this._state.matches.length
    if(match !== undefined) {
      this.editorSession.transaction((tx, args) => {
        tx.setSelection(match.getSelection())
        tx.insertText(this._state.replaceString)
        return args
      })
      this._computeMatches()
      if(index + 1 < totalMatches) {
        this._state.selectedMatch = index
      }
      this._requestLookupMatch = true
      this._setSelection()
      this._propagateUpdate()
    }
  }

  /*
    Replace all occurences
  */
  replaceAll() {
    // Reverse matches order,
    // so the replace operations later are side effect free.
    let matches = this._state.matches.reverse()

    this.editorSession.transaction((tx, args) => {
      matches.forEach(match => {
        tx.setSelection(match.getSelection())
        tx.insertText(this._state.replaceString)
      })
      return args
    })

    this._computeMatches()
  }

  /*
    Get closest match to current cursor position
  */
  _getClosestMatch() {
    let doc = this.editorSession.getDocument()
    let nodeIds = Object.keys(doc.getNodes())
    let sel = this.editorSession.getSelection()
    let closest = 0

    if(!sel.isNull()) {
      let startOffset = sel.start.offset
      let selStartNode = sel.start.path[0]
      let selStartNodePos = nodeIds.indexOf(selStartNode)
      let matches = this._state.matches

      closest = matches.findIndex(match => {
        let markerSel = match.getSelection()
        let markerStartOffset = markerSel.start.offset
        let markerStartNode = markerSel.start.path[0]
        let markerStartNodePos = nodeIds.indexOf(markerStartNode)
        if(selStartNodePos > markerStartNodePos) {
          return false
        } else if (selStartNodePos < markerStartNodePos) {
          return true
        } else {
          if(startOffset <= markerStartOffset) {
            return true
          } else {
            return false
          }
        }
      })
    }

    return closest
  }

  _computeMatches() {
    let currentMatches = this._state.matches
    let currentTotal = currentMatches === undefined ? 0 : currentMatches.length

    let newMatches = this._findAllMatches()
    this._state.matches = newMatches
    this._state.matchedNodes = Object.keys(newMatches)
    this._state.selectedMatch = [0, 0]
    // Preserve selection in case of the same number of matches
    // If the number of matches did changed we will set first selection
    // If there are no matches we should remove index

    // if(newMatches.length !== currentTotal) {
    //   this._state.selectedMatch = newMatches.length > 0 ? 0 : undefined
    // }
  }

  /*
    Returns all matches
  */
  _findAllMatches() {
    let pattern = this._state.findString

    let matches = {}
    if (pattern) {
      let surfaceManager = this.context.surfaceManager
      let surfaces = surfaceManager.getSurfaces()

      surfaces.forEach(surface => {
        let nodes = surface.getChildNodes()

        nodes.forEach((node) => {
          let content = node.getTextContent()
          let dataNode = node.props.node
          let path = []
          if(dataNode.getPath) {
            path = dataNode.getPath()
          } else {
            path.push(surface.id, dataNode.id)
          }
          let matcher = new RegExp(pattern, 'ig')
          let nodeMatches = []
          let match

          while ((match = matcher.exec(content))) {
            nodeMatches.push({
              start: match.index,
              end: matcher.lastIndex
            })
          }

          if(nodeMatches.length > 0) {
            matches[path.join('/')] = {
              path: path,
              surfaceId: surface.id,
              containerId: surface.containerId,
              matches: nodeMatches
            }
          }
        })
      })
    }

    return matches
  }

  _propagateUpdate() {
    // HACK: we make commandStates dirty in order to trigger re-evaluation
    this._updateMarkers()
    this.editorSession._setDirty('commandStates')
    this.editorSession.startFlow()
  }

  _updateMarkers() {
    const state = this._state
    const editorSession = this.editorSession
    const markersManager = editorSession.markersManager
    state.matches.forEach((m, idx) => {
      m.type = (idx === state.selectedMatch) ? 'selected-match' : 'match'
    })
    // console.log('setting find-and-replace markers', state.matches)
    markersManager.setMarkers('find-and-replace', state.matches)
  }

}

export default FindAndReplaceManager
