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
        `<div class="form-group notes-section" data-bind="if: $data != null && $data.notes != null">
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

ko.components.register('asset-icon', {
    viewModel: function (asset) {
        this.asset = asset;
    },
    template: `<img class="icon-sm" src="" data-bind="attr: { src: asset.icon ? asset.icon : null, alt: asset.name, title: asset.name}">`
});

ko.components.register('residence-label', {
    viewModel: function (residence) {
        this.residence = residence;
    },
    template:
        `<div class="inline-list mr-3" data-bind="attr: {title: residence.name}">
            <div data-bind="component: {name: 'asset-icon', params: residence.populationLevel}"></div>
            <div data-bind="component: {name: 'asset-icon', params: residence}"></div>
            <div data-bind="text: residence.floorCount"></div>
        </div>`
})

ko.components.register('residence-effect-entry', {
    viewModel: function (params) {
        this.entries = params.entries;
        this.filter = params.filter;
        this.texts = window.view.texts;
    },
    template:
        `<div class="inline-list-centered" data-bind="foreach: entries">
             <div class="inline-list mr-3" data-bind="if: product.available() && ($parent.filter == null || $parent.filter.has(product))">
                <div data-bind="component: { name: 'asset-icon', params: product}" ></div>
                <div data-bind="if: consumptionModifier !== 0">
                    <img class="icon-sm icon-light ml-1" src="icons/icon_marketplace_2d_light.png" data-bind="attr: {title: $parent.texts.reduceConsumption.name}">
                    <span data-bind="text: formatPercentage(consumptionModifier)"></span>
                </div>
                <div data-bind="if: residents !== 0">
                    <img class="icon-sm icon-light ml-1" src="icons/icon_resource_population.png" data-bind="attr: {title: $parent.texts.bonusResidents.name}">
                    <span data-bind="text: '+' + residents"></span>
                </div>
                <div class="inline-list" data-bind="if: suppliedBy.length !== 0">
                    <img class="icon-sm icon-light ml-1" src="icons/icon_transfer_goods_light.png" data-bind="attr: {title: $parent.texts.bonusSupply.name}">
                    <div class="inline-list" data-bind="foreach: {data: suppliedBy, as: 'product'}">
                        <span data-bind="component: {name: 'asset-icon', params: product}"></span>
                    </div>
                </div>
            </div>
        </div>
        `
});

ko.components.register('replacement', {
    viewModel: function (params) {
        this.old = params.old;
        this.replacing = params.new;
    }, template:
        ` <div class="ui-fchain-item-icon-replacement">
            <span class="strike-through">
                <img class="icon-sm" src="" data-bind="attr: { src: old.icon ? old.icon : null, alt: old.name }">
            </span>
            <!-- ko if: replacing -->
            <div class="ui-replacement-spacer">
                    &rarr;
            </div>
            <div>
                <img class="icon-sm" src="" data-bind="attr: { src: replacing.icon ? replacing.icon : null, alt: replacing.name }">
            </div>
            <!-- /ko -->
        </div>`
});

ko.components.register('existing-buildings-input', {
    viewModel: function (asset) {
        this.asset = asset;
        this.texts = window.view.texts;
    }, template:
        `<div class="input-group input-group-short spinner float-left" style="max-width: 10rem;">
            <div class="input-group-prepend" data-bind="src: {title: texts.residences.name()}">
                <div class="input-group-text">
                    <img class="icon-sm icon-light" src="icons/icon_house_white.png" />
                </div>
            </div>
            <input class="form-control" type="number" value="0" step="1" min="0" data-bind="value: asset.existingBuildings, enable: asset.canEdit == null || asset.canEdit(), attr: {id: asset.guid + '-existing-buildings-input'}" />
            <div class="input-group-append">
                <div data-bind="component: { name: 'number-input-increment', params: { obs: asset.existingBuildings, id: asset.guid + '-existing-buildings-input' }}"></div>
            </div>
        </div>`
});

ko.components.register('icon-checkbox', {
    viewModel: function (params) {
        this.asset = params.asset;
        this.checked = params.checked || this.asset.checked;
        this.id = params.id || this.asset.guid;
        this.title = params.title || this.asset.name
    }, template:
        `<div class="custom-control custom-checkbox">
            <input type="checkbox" class="custom-control-input" data-bind="checked: checked, attr: { 'id': id, 'title': title() }">
            <label class="custom-control-label" data-bind="attr: { for: id }" src-only style="vertical-align: top;">
                <span class="mr-2" style="flex-basis: fit-content;">
                    <img class="icon-sm" src="" data-bind="attr: { src: asset.icon ? asset.icon  : null, alt: title(), for: id }" />
                </span>
            </label>
        </div>`
});

ko.components.register('additional-output', {
    viewModel: function (params) {
        this.amount = params.amount;
        this.texts = window.view.texts;
    }, template:
        `<div data-bind="src: { title: texts.extraGoods.name}">
            <img class="icon-sm icon-light mr-2" src="icons/icon_add_goods_socket_white.png"/>
            <span data-bind="text: formatNumber(amount()) + ' t/min'"></span>
        </div>`
});