// @ts-check
import { NumberInputHandler } from './util.js'

var ko = require( "knockout" );

ko.components.register('number-input-increment', {
    viewModel: {
        // - 'params' is an object whose key/value pairs are the parameters
        //   passed from the component binding or custom element
        // - 'componentInfo.element' is the element the component is being
        //   injected into. When createViewModel is called, the template has
        //   already been injected into this element, but isn't yet bound.
        // - 'componentInfo.templateNodes' is an array containing any DOM
        //   nodes that have been supplied to the component. See below.
        createViewModel: (params, componentInfo) => new NumberInputHandler(params)
    },
    template:
        `<div class="input-group-btn-vertical" >
                                                        <button class="btn btn-default" type="button" data-bind="click: (_, evt) => {var factor = getInputFactor(evt); var val = parseFloat(obs()) + factor * step + ACCURACY; obs(Math.floor(val/step)*step)}, enable: obs() < max"><i class="fa fa-caret-up"></i></button>
                                                        <button class="btn btn-default" type="button" data-bind="click: (_, evt) => {var factor = getInputFactor(evt); var val = parseFloat(obs()) - factor * step - ACCURACY; obs(Math.ceil(val/step)*step)}, enable: obs() > min"><i class="fa fa-caret-down"></i></button>
                                                    </div>`
});

ko.components.register('notes-section', {
    template:
        `<div class="form-group notes-section" data-bind="if: $data.notes != null">
              <textarea class="form-control" data-bind="textInput: $data.notes, attr: {placeholder: $root.texts.notes.name()}"></textarea>
        </div>`
});

ko.components.register('lock-toggle', {
    template:
        `<div style="cursor: pointer" data-bind="click: () => {checked(!checked());}">
             <img class="icon-sm icon-light" src="icons/icon_unlock.png" data-bind="style: {display : checked()? 'none' : 'inherit'}">
             <img class="icon-sm icon-light" src="icons/icon_lock.png" style="display: none;"  data-bind="style: {display : checked()? 'inherit' : 'none'}">
        </div>`
});