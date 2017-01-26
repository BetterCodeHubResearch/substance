import isArrayEqual from '../util/isArrayEqual'
import annotationHelpers from '../model/annotationHelpers'

class TextNodeEditing {

  /*
    <-->: anno
    |--|: area of change
    I: <--> |--|     :   nothing
    II: |--| <-->    :   move both by total span+L
    III: |-<-->-|    :   delete anno
    IV: |-<-|->      :   move start by diff to start+L, and end by total span+L
    V: <-|->-|       :   move end by diff to start+L
    VI: <-|--|->     :   move end by total span+L
  */
  insertText(tx, sel, text) {
    let start = sel.start
    let end = sel.end
    if (!isArrayEqual(start.path, end.path)) {
      throw new Error('Unsupported state: range should be on one property')
    }
    let realPath = tx.getRealPath(start.path)
    let startOffset = start.offset
    let endOffset = end.offset
    let typeover = !sel.isCollapsed()
    let L = text.length
    // delete selected text
    if (typeover) {
      tx.update(realPath, { type: 'delete', start: startOffset, end: endOffset })
    }
    // insert new text
    tx.update(realPath, { type: 'insert', start: startOffset, text: text })
    // update annotations
    let annos = tx.getAnnotations(realPath)
    annos.forEach(function(anno) {
      let annoStart = anno.start.offset
      let annoEnd = anno.end.offset
      // I anno is before
      if (annoEnd<startOffset) {
        return
      }
      // II anno is after
      else if (annoStart>=endOffset) {
        tx.update([anno.id, 'start'], { type: 'shift', value: startOffset-endOffset+L })
        tx.update([anno.id, 'end'], { type: 'shift', value: startOffset-endOffset+L })
      }
      // III anno is deleted
      else if (annoStart>=startOffset && annoEnd<endOffset) {
        tx.delete(anno.id)
      }
      // IV anno.start between and anno.end after
      else if (annoStart>=startOffset && annoEnd>=endOffset) {
        // do not move start if typing over
        if (annoStart>startOffset || !typeover) {
          tx.update([anno.id, 'start'], { type: 'shift', value: startOffset-annoStart+L })
        }
        tx.update([anno.id, 'end'], { type: 'shift', value: startOffset-endOffset+L })
      }
      // V anno.start before and anno.end between
      else if (annoStart<startOffset && annoEnd<endOffset) {
        // NOTE: here the anno gets expanded (that's the common way)
        tx.update([anno.id, 'end'], { type: 'shift', value: startOffset-annoEnd+L })
      }
      // VI anno.start before and anno.end after
      else if (annoStart<startOffset && annoEnd>=endOffset) {
        tx.update([anno.id, 'end'], { type: 'shift', value: startOffset-endOffset+L })
      }
      else {
        console.warn('TODO: handle annotation update case.')
      }
    })
    let offset = startOffset + text.length
    tx.setSelection({
      type: 'property',
      path: start.path,
      startOffset: offset,
      containerId: sel.containerId,
      surfaceId: sel.surfaceId
    })
  }

  /*
    <-->: anno
    |--|: area of change
    I: <--> |--|     :   nothing
    II: |--| <-->    :   move both by total span
    III: |-<-->-|    :   delete anno
    IV: |-<-|->      :   move start by diff to start, and end by total span
    V: <-|->-|       :   move end by diff to start
    VI: <-|--|->     :   move end by total span
  */
  deleteRange(tx, start, end, containerId) {
    if (!start) {
      start = {
        path: end.path,
        offset: 0
      }
    }
    let realPath = tx.getRealPath(start.path)
    let node = tx.get(realPath[0])
    if (!node.isText()) throw new Error('Expecting a TextNode.')
    if (!end) {
      end = {
        path: start.path,
        offset: node.getLength()
      }
    }
    if (!isArrayEqual(start.path, end.path)) throw new Error('Unsupported state: selection should be on one property')
    let startOffset = start.offset
    let endOffset = end.offset
    tx.update(realPath, { type: 'delete', start: startOffset, end: endOffset })
    // update annotations
    let annos = tx.getAnnotations(realPath)
    annos.forEach(function(anno) {
      let annoStart = anno.start.offset
      let annoEnd = anno.end.offset
      // I anno is before
      if (annoEnd<=startOffset) {
        return
      }
      // II anno is after
      else if (annoStart>=endOffset) {
        tx.update([anno.id, 'start'], { type: 'shift', value: startOffset-endOffset })
        tx.update([anno.id, 'end'], { type: 'shift', value: startOffset-endOffset })
      }
      // III anno is deleted
      else if (annoStart>=startOffset && annoEnd<=endOffset) {
        tx.delete(anno.id)
      }
      // IV anno.start between and anno.end after
      else if (annoStart>=startOffset && annoEnd>=endOffset) {
        if (annoStart>startOffset) {
          tx.update([anno.id, 'start'], { type: 'shift', value: startOffset-annoStart })
        }
        tx.update([anno.id, 'end'], { type: 'shift', value: startOffset-endOffset })
      }
      // V anno.start before and anno.end between
      else if (annoStart<=startOffset && annoEnd<=endOffset) {
        tx.update([anno.id, 'end'], { type: 'shift', value: startOffset-annoEnd })
      }
      // VI anno.start before and anno.end after
      else if (annoStart<startOffset && annoEnd >= endOffset) {
        tx.update([anno.id, 'end'], { type: 'shift', value: startOffset-endOffset })
      }
      else {
        console.warn('TODO: handle annotation update case.')
      }
    })
    tx.setSelection({
      type: 'property',
      path: start.path,
      startOffset: startOffset,
      containerId: containerId
    })
  }

  break(tx, node, coor, container) {
    let path = coor.path
    let offset = coor.offset
    let nodePos = container.getPosition(node.id)
    let text = node.getText()

    // when breaking at the first position, a new node of the same
    // type will be inserted.
    if (offset === 0) {
      let newNode = tx.create({
        type: node.type,
        content: ""
      })
      // show the new node
      container.show(newNode.id, nodePos)
      tx.setSelection({
        type: 'property',
        path: path,
        startOffset: 0,
        containerId: container.id
      })
    }
    // otherwise split the text property and create a new paragraph node with trailing text and annotations transferred
    else {
      let newNode = node.toJSON()
      delete newNode.id
      newNode.content = text.substring(offset)
      // if at the end insert a default text node no matter in which text node we are
      if (offset === text.length) {
        newNode.type = tx.getSchema().getDefaultTextType()
      }
      newNode = tx.create(newNode)
      // Now we need to transfer annotations
      if (offset < text.length) {
        // transfer annotations which are after offset to the new node
        annotationHelpers.transferAnnotations(tx, path, offset, newNode.getTextPath(), 0)
        // truncate the original property
        tx.update(path, { type: 'delete', start: offset, end: text.length })
      }
      // show the new node
      container.show(newNode.id, nodePos+1)
      // update the selection
      tx.setSelection({
        type: 'property',
        path: newNode.getTextPath(),
        startOffset: 0,
        containerId: container.id
      })
    }
  }

  // TODO: the concept for implementing merge could still be improved
  // e.g. it is strange to implement merge text-list here
  merge(tx, node, coor, container, direction, previous, next) {
    let first, second
    if (direction === 'left') {
      if (!previous) return
      first = previous
      second = node
    } else if (direction === 'right') {
      if (!next) return
      first = node
      second = next
    }
    if (!first.isText() && direction === 'left') {
      if (second.isEmpty()) {
        container.hide(second.id)
        tx.delete(second.id)
        tx.setSelection({
          type: 'node',
          nodeId: first.id,
          mode: 'after',
          containerId: container.id
        })
      } else {
        tx.setSelection({
          type: 'node',
          nodeId: first.id,
          mode: 'full',
          containerId: container.id
        })
      }
    } else if (!second.isText() && direction === 'right') {
      if (first.isEmpty()) {
        container.hide(first.id)
        tx.delete(first.id)
        tx.setSelection({
          type: 'node',
          nodeId: second.id,
          mode: 'before',
          containerId: container.id
        })
      } else {
        tx.setSelection({
          type: 'node',
          nodeId: second.id,
          mode: 'full',
          containerId: container.id
        })
      }
    } else if (first && second && first.isText() && second.isText()) {
      let firstPath = first.getTextPath()
      let firstText = first.getText()
      let firstLength = firstText.length
      let secondPath = second.getTextPath()
      let secondText = second.getText()
      if (firstLength === 0) {
        // hide the second node
        container.hide(first.id)
        // delete the second node
        tx.delete(first.id)
        // set the selection to the end of the first component
        tx.setSelection({
          type: 'property',
          path: secondPath,
          startOffset: 0,
          containerId: container.id
        })
      } else {
        // append the second text
        tx.update(firstPath, { type: 'insert', start: firstLength, text: secondText })
        // transfer annotations
        annotationHelpers.transferAnnotations(tx, secondPath, 0, firstPath, firstLength)
        // hide the second node
        container.hide(secondPath[0])
        // delete the second node
        tx.delete(secondPath[0])
        // set the selection to the end of the first component
        tx.setSelection({
          type: 'property',
          path: firstPath,
          startOffset: firstLength,
          containerId: container.id
        })
      }
    } else {
      console.warn('Unsupported merge', first, second)
    }
  }

  // FIXME: a weird normalization was done here
  // probably dealing with the special forms of node selections?
  // _asRange(tx, sel) {
  //   // HACK: this is not really cool
  //   let start = sel.start
  //   let end = sel.end
  //   if (range.start === 'before') {
  //     start = { path: tx.get(end.path[0]).getTextPath(), offset: 0 }
  //   } else if (range.start.path.length === 1) {
  //     start = { path: tx.get(start.path[0]).getTextPath(), offset: range.start.offset }
  //   }
  //   if (range.end === 'after') {
  //     end = { path:  tx.get(start.path[0]).getTextPath(), offset: tx.get(start.path[0]).getText().length }
  //   } else if (range.end.path.length === 1) {
  //     end = { path: tx.get(end.path[0]).getTextPath(), offset: tx.get(end.path[0]).getText().length }
  //   }
  //   if (!start._isCoordinate) start = new Coordinate(start.path, start.offset)
  //   if (!end._isCoordinate) end = new Coordinate(end.path, end.offset)
  //   return new Range(start, end)
  // }
}

export default TextNodeEditing