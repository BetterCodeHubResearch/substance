import Schema from './Schema'
import DocumentNode from './DocumentNode'
import Container from './Container'
import PropertyAnnotation from './PropertyAnnotation'
import ContainerAnnotation from './ContainerAnnotation'

class DocumentSchema extends Schema {

  constructor(schemaSpec) {
    super(schemaSpec.name, schemaSpec.version)
    /* istanbul ignore next */
    if (!schemaSpec.DocumentClass) {
      throw new Error('DocumentClass is mandatory')
    }
    Object.assign(this, schemaSpec)

    // TODO: defaultTextType does not make sense in certain environments
    if (!this.defaultTextType) {
      this.defaultTextType = 'text'
    }
  }

  getDocumentClass() {
    return this.DocumentClass
  }

  /*
    @override
  */
  getDefaultTextType() {
    return this.defaultTextType
  }

  /*
    @override
  */
  getBuiltIns() {
    return [DocumentNode, PropertyAnnotation, Container, ContainerAnnotation]
  }

}

export default DocumentSchema
