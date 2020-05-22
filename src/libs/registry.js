import { shallowEqualObjects, has, getNested, setNested } from './utils'

/**
 * Component registry with inherent depth to handle complex nesting. This is
 * important for features such as grouped fields.
 */
class Registry {
    /**
     * Create a new registry of components.
     * @param {vm} ctx The host vm context of the registry.
     */
    constructor (ctx) {
        this.registry = new Map()
        this.ctx = ctx
    }

    /**
     * Add an item to the registry.
     * @param {string|array} key
     * @param {vue} component
     */
    add (name, component) {
        this.registry.set(name, component)
        return this
    }

    /**
     * Remove an item from the registry.
     * @param {string} name
     */
    remove (name) {
        this.registry.delete(name)
        const { [name]: value, ...newProxy } = this.ctx.proxy
        this.ctx.proxy = newProxy
        return this
    }

    /**
     * Check if the registry has the given key.
     * @param {string|array} key
     */
    has (key) {
        return this.registry.has(key)
    }

    /**
     * Get a particular registry value.
     * @param {string} key
     */
    get (key) {
        return this.registry.get(key)
    }

    /**
     * Map over the registry (recursively).
     * @param {function} callback
     */
    map (callback) {
        const value = {}
        this.registry.forEach((component, field) => Object.assign(value, { [field]: callback(component, field) }))
        return value
    }

    /**
     * Return the keys of the registry.
     */
    keys () {
        return Array.from(this.registry.keys())
    }

    /**
     * Fully register a component.
     * @param {string} field name of the field.
     * @param {vm} component the actual component instance.
     */
    register (field, component) {
        if (this.registry.has(field)) {
            return false
        }
        this.registry.set(field, component)
        const hasVModelValue = has(component.$options.propsData, 'formularioValue')
        const hasValue = has(component.$options.propsData, 'value')
        if (
            !hasVModelValue &&
            this.ctx.hasInitialValue &&
            getNested(this.ctx.initialValues, field) !== undefined
        ) {
            // In the case that the form is carrying an initial value and the
            // element is not, set it directly.
            component.context.model = getNested(this.ctx.initialValues, field)
        } else if (
            (hasVModelValue || hasValue) &&
            !shallowEqualObjects(component.proxy, getNested(this.ctx.initialValues, field))
        ) {
            // In this case, the field is v-modeled or has an initial value and the
            // form has no value or a different value, so use the field value
            this.ctx.setFieldValue(field, component.proxy)
        }
        if (this.childrenShouldShowErrors) {
            component.formShouldShowErrors = true
        }
    }

    /**
     * Reduce the registry.
     * @param {function} callback
     */
    reduce (callback, accumulator) {
        this.registry.forEach((component, field) => {
            accumulator = callback(accumulator, component, field)
        })
        return accumulator
    }

    /**
     * Data props to expose.
     */
    dataProps () {
        return {
            proxy: {},
            registry: this,
            register: this.register.bind(this),
            deregister: field => this.remove(field),
            childrenShouldShowErrors: false
        }
    }
}

/**
 * The context component.
 * @param {component} contextComponent
 */
export default function useRegistry (contextComponent) {
    const registry = new Registry(contextComponent)
    return registry.dataProps()
}

/**
 * Computed properties related to the registry.
 */
export function useRegistryComputed () {
    return {
        hasInitialValue () {
            return (
                (this.formularioValue && typeof this.formularioValue === 'object') ||
                (this.values && typeof this.values === 'object') ||
                (this.isGrouping && typeof this.context.model[this.index] === 'object')
            )
        },
        isVmodeled () {
            return !!(this.$options.propsData.hasOwnProperty('formularioValue') &&
                this._events &&
                Array.isArray(this._events.input) &&
                this._events.input.length)
        },
        initialValues () {
            if (
                has(this.$options.propsData, 'formularioValue') &&
                typeof this.formularioValue === 'object'
            ) {
                // If there is a v-model on the form/group, use those values as first priority
                return Object.assign({}, this.formularioValue) // @todo - use a deep clone to detach reference types
            } else if (
                has(this.$options.propsData, 'values') &&
                typeof this.values === 'object'
            ) {
                // If there are values, use them as secondary priority
                return Object.assign({}, this.values)
            } else if (
                this.isGrouping && typeof this.context.model[this.index] === 'object'
            ) {
                return this.context.model[this.index]
            }
            return {}
        }
    }
}

/**
 * Methods used in the registry.
 */
export function useRegistryMethods (without = []) {
    const methods = {
        applyInitialValues () {
            if (this.hasInitialValue) {
                this.proxy = this.initialValues
            }
        },
        setFieldValue (field, value) {
            if (value === undefined) {
                const { [field]: value, ...proxy } = this.proxy
                this.proxy = proxy
            } else {
                setNested(this.proxy, field, value);
            }
            this.$emit('input', Object.assign({}, this.proxy))
        },
        getFormValues () {
            return this.proxy
        },
        hasValidationErrors () {
            return Promise.all(this.registry.reduce((resolvers, cmp, name) => {
                resolvers.push(cmp.performValidation() && cmp.getValidationErrors())
                return resolvers
            }, [])).then(errorObjects => errorObjects.some(item => item.hasErrors))
        },
        showErrors () {
            this.childrenShouldShowErrors = true
            this.registry.map(input => {
                input.formShouldShowErrors = true
            })
        },
        hideErrors () {
            this.childrenShouldShowErrors = false
            this.registry.map(input => {
                input.formShouldShowErrors = false
                input.behavioralErrorVisibility = false
            })
        },
        setValues (values) {
            // Collect all keys, existing and incoming
            const keys = Array.from(new Set(Object.keys(values).concat(Object.keys(this.proxy))))
            keys.forEach(field => {
                if (this.registry.has(field) &&
                    !shallowEqualObjects(getNested(values, field), getNested(this.proxy, field)) &&
                    !shallowEqualObjects(getNested(values, field), this.registry.get(field).proxy)
                ) {
                    this.setFieldValue(field, getNested(values, field))
                    this.registry.get(field).context.model = getNested(values, field)
                }
            })
        }
    }
    return Object.keys(methods).reduce((withMethods, key) => {
        return without.includes(key) ? withMethods : { ...withMethods, [key]: methods[key] }
    }, {})
}

/**
 * Providers related to the registry.
 */
export function useRegistryProviders (ctx) {
    return {
        formularioSetter: ctx.setFieldValue,
        formularioRegister: ctx.register,
        formularioDeregister: ctx.deregister,
        getFormValues: ctx.getFormValues
    }
}