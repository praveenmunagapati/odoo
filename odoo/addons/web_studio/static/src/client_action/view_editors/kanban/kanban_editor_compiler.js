/** @odoo-module */
import { KanbanCompiler } from "@web/views/kanban/kanban_compiler";
import { computeXpath, applyInvisible } from "../xml_utils";
import { isComponentNode } from "@web/views/view_compiler";
import { createElement } from "@web/core/utils/xml";
import { _lt } from "@web/core/l10n/translation";

const interestingSelector = [
    "field",
    "widget",
    ".dropdown",
    ".o_dropdown_kanban",
    "img.oe_kanban_avatar",
    ".o_kanban_record_body",
    ".o_kanban_record_bottom",
].join(", ");

export class KanbanEditorCompiler extends KanbanCompiler {
    constructor() {
        super(...arguments);
        const kanbanBox = this.templates["kanban-box"];
        this.isDashboard = kanbanBox.closest("kanban").classList.contains("o_kanban_dashboard");
    }

    applyInvisible(invisible, compiled, params) {
        return applyInvisible(invisible, compiled, params);
    }

    compile(key, params = {}) {
        params.enableInvisible = true;
        const xml = this.templates[key];

        // One pass to compute and add the xpath for the arch's node location
        // onto that node.
        const mainDiv = xml.querySelector("div");
        const interestingArchNodes = [...xml.querySelectorAll(interestingSelector)];
        if (mainDiv) {
            interestingArchNodes.push(mainDiv);
        }
        for (const el of interestingArchNodes) {
            const xpath = computeXpath(el, "kanban");
            el.setAttribute("studioXpath", xpath);
        }

        const compiled = super.compile(key, params);

        const isKanbanBox = key === "kanban-box";

        if (isKanbanBox && !this.isDashboard && mainDiv) {
            const tagsWidget = xml.querySelector("field[widget='many2many_tags']");
            if (!tagsWidget) {
                this.addTagsWidgetHook(compiled);
            }

            const dropdown = xml.querySelector(".dropdown, .o_dropdown_kanban");
            if (!dropdown) {
                this.addDropdownHook(compiled);
            }

            const priorityWidget = xml.querySelector("field[widget='priority']");
            const favoriteWidget = xml.querySelector("field[widget='boolean_favorite']");
            if (!priorityWidget && !favoriteWidget) {
                this.addPriorityHook(compiled);
            }

            const avatarImg = xml.querySelector("img.oe_kanban_avatar");
            if (!avatarImg) {
                this.addAvatarHook(compiled);
            }
        }

        compiled.querySelectorAll("a[data-type='set_cover']").forEach((el) => {
            const dropdown = el.closest("Dropdown");
            dropdown.setAttribute("hasCoverSetter", "true");
        });

        compiled.querySelectorAll(".oe_kanban_avatar").forEach((el) => {
            const tIf = el.closest("[t-if]");
            if (tIf) {
                const tElse = createElement("t", {
                    "t-else": "",
                    "t-call": "web_studio.KanbanEditorRecord.AvatarPlaceholder",
                });
                tIf.insertAdjacentElement("afterend", tElse);
            }
        });

        return compiled;
    }

    compileField(node) {
        const compiled = super.compileField(...arguments);
        if (compiled.tagName === "span") {
            const fieldName = node.getAttribute("name");
            compiled.setAttribute("data-field-name", fieldName);
        } else {
            compiled.setAttribute("hasEmptyPlaceholder", true);
        }

        return compiled;
    }

    addStudioHook(node, compiled) {
        const tNode = createElement("t");
        if (compiled.hasAttribute("t-if")) {
            // t-if from the invisible modifier
            tNode.setAttribute("t-if", compiled.getAttribute("t-if"));
            compiled.removeAttribute("t-if");
        }
        tNode.appendChild(compiled);
        const xpath = node.getAttribute("studioXpath");
        const studioHook = createElement("StudioHook", {
            xpath: `"${xpath}"`,
            position: "'after'",
        });
        tNode.appendChild(studioHook);
        return tNode;
    }

    compileNode(node, params) {
        const nodeType = node.nodeType;
        if (nodeType === 1 && isComponentNode(node)) {
            return;
        }

        let compiled = super.compileNode(...arguments);

        if (nodeType === 1 && compiled) {
            // Put a xpath on anything of interest.
            if (node.hasAttribute("studioXpath")) {
                const xpath = node.getAttribute("studioXpath");
                if (isComponentNode(compiled)) {
                    compiled.setAttribute("studioXpath", `"${xpath}"`);
                } else if (!compiled.hasAttribute("studioXpath")) {
                    compiled.setAttribute("studioXpath", xpath);
                }

                if (node.classList.contains("oe_kanban_avatar")) {
                    compiled.setAttribute(
                        "t-on-click",
                        `(ev) => env.config.onNodeClicked({
                            xpath: "${xpath}",
                            target: ev.target
                        })`
                    );
                    compiled.classList.add("o-web-studio-editor--element-clickable");
                }
                if (node.tagName === "field" && !isComponentNode(compiled)) {
                    compiled.setAttribute(
                        "t-on-click",
                        `(ev) => env.config.onNodeClicked({xpath: "${xpath}", target: ev.target})`
                    );
                    compiled.classList.add("o-web-studio-editor--element-clickable");

                    const fieldName = node.getAttribute("name");
                    const isEmptyExpr = `isFieldValueEmpty(record["${fieldName}"].value)`;

                    // Set empty class
                    const tattfClassEmpty = `{{ ${isEmptyExpr} ? "o_web_studio_widget_empty" : "" }}`;

                    const tattfClass = compiled.getAttribute("t-attf-class");

                    const nextAttfClass = tattfClass
                        ? `${tattfClass} ${tattfClassEmpty}`
                        : tattfClassEmpty;
                    compiled.setAttribute("t-attf-class", nextAttfClass);

                    // Set field name on empty
                    const tOut = compiled.getAttribute("t-out");
                    compiled.setAttribute(
                        "t-out",
                        `${isEmptyExpr} ? props.record.activeFields["${fieldName}"].string : ${tOut}`
                    );
                }
                if (node.tagName === "field" || node.tagName === "widget") {
                    // Don't append a studio hook if a condition is on the tag itself
                    // otherwise it may cause inconsistencies in the arch itself
                    // ie `<field t-elif="someCondifiton" /><field name="newField" /><t t-else=""/>` would be invalid
                    if (
                        !Array.from(node.attributes).filter((att) =>
                            ["t-if", "t-elif", "t-else"].includes(att)
                        )[0]
                    ) {
                        compiled = this.addStudioHook(node, compiled);
                    }
                }
            }
        }
        return compiled;
    }

    addTagsWidgetHook(compiled) {
        const parentElement =
            compiled.querySelector(".o_kanban_record_body") || compiled.querySelector("div");
        const tagsHook = createElement("span", {
            class: "o_web_studio_add_kanban_tags",
            "t-on-click": `() => this.onAddTagsWidget({
                xpath: "${parentElement.getAttribute("studioXpath")}"
            })`,
        });
        tagsHook.textContent = _lt("Add tags");

        if (parentElement.firstChild) {
            parentElement.insertBefore(tagsHook, parentElement.firstChild);
        } else {
            parentElement.appendChild(tagsHook);
        }
    }

    addDropdownHook(compiled) {
        const parentElement = compiled.querySelector("div");
        const dropdownHook = createElement(
            "div",
            [
                createElement("a", {
                    class: "btn fa fa-ellipsis-v",
                }),
            ],
            {
                class: "o_web_studio_add_dropdown o_dropdown_kanban dropdown",
                style: "z-index: 1;",
                "t-on-click": "onAddDropdown",
            }
        );
        if (parentElement.firstChild) {
            parentElement.insertBefore(dropdownHook, parentElement.firstChild);
        } else {
            parentElement.appendChild(dropdownHook);
        }
    }

    addPriorityHook(compiled) {
        const parentElement = compiled.querySelector("div");
        const priorityHook = createElement("div", {
            class: "o_web_studio_add_priority oe_kanban_bottom_left align-self-start flex-grow-0",
            style: "z-index: 1;",
            "t-on-click": "() => this.onAddPriority()",
        });
        priorityHook.textContent = _lt("Add a priority");
        parentElement.appendChild(priorityHook);
    }

    addAvatarHook(compiled) {
        const parentElement =
            compiled.querySelector(".o_kanban_record_bottom") || compiled.querySelector("div");
        const avatarHook = createElement("div", {
            class: "o_web_studio_add_kanban_image oe_kanban_bottom_right pe-auto",
            style: "z-index: 1;",
            "t-on-click": "() => this.onAddAvatar()",
        });
        avatarHook.textContent = _lt("Add an avatar");
        parentElement.appendChild(avatarHook);
    }
}
