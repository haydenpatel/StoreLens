import React, { useEffect, useId, useRef, useState } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Search, X } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator"
import { cn } from "@/lib/utils";
import { formatCount } from "@/lib/locale";
import { formatMoneyRange } from "@/lib/currency";


export default function Sidebar({
  filterData,
  capabilities = {},
  labels = {},
  searchQuery,
  setSearchQuery,
  selectedVendors,
  setSelectedVendors,
  selectedTypes,
  setSelectedTypes,
  selectedTags,
  setSelectedTags,
  selectedOptions,
  setSelectedOptions,
  priceRange,
  setPriceRange,
  inStockOnly,
  setInStockOnly,
  saleOnly,
  setSaleOnly,
  onReset,
  activeFilterCount,
  isOpen = false,
  onClose = () => {},
}) {
  const toggleSelection = (array, setter, value) => {
    if (array.includes(value)) {
      setter(array.filter(v => v !== value));
    } else {
      setter([...array, value]);
    }
  };

  const toggleOption = (optionKey, value) => {
    const current = selectedOptions[optionKey] || [];
    if (current.includes(value)) {
      setSelectedOptions({
        ...selectedOptions,
        [optionKey]: current.filter(v => v !== value)
      });
    } else {
      setSelectedOptions({
        ...selectedOptions,
        [optionKey]: [...current, value]
      });
    }
  };

  const hasActiveFilters = activeFilterCount > 0;

  // Below xl the sidebar is an off-screen drawer rather than a permanently
  // docked panel, so its controls need to be inert (and focus managed) while
  // closed instead of just visually translated away.
  const [isDesktop, setIsDesktop] = useState(
    () => typeof window !== "undefined" && window.matchMedia("(min-width: 1280px)").matches
  );
  const headingId = useId();
  const headingRef = useRef(null);
  const closeButtonRef = useRef(null);
  const asideRef = useRef(null);

  useEffect(() => {
    const mql = window.matchMedia("(min-width: 1280px)");
    const handleChange = (e) => setIsDesktop(e.matches);
    mql.addEventListener("change", handleChange);
    return () => mql.removeEventListener("change", handleChange);
  }, []);

  useEffect(() => {
    if (!isOpen || isDesktop) return;
    const previouslyFocused = document.activeElement;
    closeButtonRef.current?.focus();
    return () => {
      if (previouslyFocused instanceof HTMLElement) previouslyFocused.focus();
    };
  }, [isOpen, isDesktop]);

  // Trap Tab navigation inside the drawer while it's open on mobile/tablet,
  // so keyboard focus can't reach the header/main content hidden behind the
  // backdrop.
  useEffect(() => {
    if (!isOpen || isDesktop) return;
    const aside = asideRef.current;
    if (!aside) return;

    function handleKeyDown(e) {
      if (e.key === "Escape") {
        onClose();
        return;
      }
      if (e.key !== "Tab") return;
      const focusable = aside.querySelectorAll(
        'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
      );
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, isDesktop, onClose]);

  return (
    <>
      {/* Mobile-only backdrop, closes the drawer on tap */}
      {isOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/40 xl:hidden"
          onClick={onClose}
          aria-hidden="true"
        />
      )}
      <aside
        ref={asideRef}
        {...(isDesktop ? {} : { role: "dialog", "aria-modal": "true", "aria-labelledby": headingId })}
        className={cn(
          "fixed left-0 top-0 z-50 h-screen w-80 max-w-[85vw] bg-secondary border-r border-sidebar-border shadow-xl transition-transform duration-200 ease-in-out",
          isOpen ? "translate-x-0" : "-translate-x-full",
          "xl:sticky xl:top-[73px] xl:left-auto xl:z-auto xl:h-[calc(100vh-73px)] xl:max-w-none xl:translate-x-0 xl:shadow-none xl:bg-transparent"
        )}
        inert={isDesktop ? undefined : !isOpen}
      >
      <ScrollArea className="h-full">
        <div className="p-6 space-y-6">
          {/* Search */}
          <div className="space-y-2">
            {/* <h2 className="font-semibold text-sidebar-primary">Search</h2> */}
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-sidebar-accent-foreground" />
              <Input
                type="text"
                placeholder="Search products..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className={cn("pl-9 text-sm", searchQuery && "pr-9")}
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery("")}
                  aria-label="Clear search"
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-sidebar-accent-foreground hover:text-sidebar-primary"
                >
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>
          </div>

          {/* Header */}
          <div className="flex items-center justify-between gap-2">
            <h2 id={headingId} ref={headingRef} tabIndex={-1} className="font-semibold text-sidebar-primary outline-none">Filters</h2>
            <div className="flex items-center gap-2">
            {hasActiveFilters && (
              <Button
                variant="default"
                size="sm"
                onClick={() => {
                  onReset();
                  // Reset turns into a disabled button; keep focus on the heading
                  // rather than letting it fall to <body>.
                  headingRef.current?.focus();
                }}
              >
                <X className="w-3 h-3 mr-1" />
                Reset
              </Button>
            )}
            {!hasActiveFilters && ( /* Filters in default state */
              <Button
                variant="disabled"
                size="sm"
                disabled
              >
                <X className="w-3 h-3 mr-1" />
                Reset
              </Button>
            )}
            <Button
              ref={closeButtonRef}
              variant="ghost"
              size="icon"
              className="xl:hidden"
              onClick={onClose}
              aria-label="Close filters"
            >
              <X className="w-4 h-4" />
            </Button>
            </div>
          </div>

          {/* In Stock Only */}
          {capabilities.variantStock !== false && (
            <div className="flex items-center space-x-2">
              <Checkbox
                id="inStock"
                checked={inStockOnly}
                onCheckedChange={setInStockOnly}
              />
              <Label htmlFor="inStock" className="text-sm cursor-pointer">
                In stock only
              </Label>
            </div>
          )}
          
          {/* Sale Only */}
          <div className="flex items-center space-x-2">
            <Checkbox
              id="saleOnly"
              checked={saleOnly}
              onCheckedChange={setSaleOnly}
            />
            <Label htmlFor="saleOnly" className="text-sm cursor-pointer">
              On sale only
            </Label>
          </div>

          {/* Price Range */}
          <div className="space-y-3">
            <Label className="text-sm font-medium">
              Price Range: <span className="font-[350]">{formatMoneyRange(priceRange[0], priceRange[1], filterData.currency, { decimals: 0 })}</span>
            </Label>
            {/* With one price there is nothing to choose, and Radix computes
                NaN% positions (division by a zero range), so show no slider. */}
            {filterData.minPrice < filterData.maxPrice && (
              <Slider
                min={filterData.minPrice}
                max={filterData.maxPrice}
                step={1}
                value={priceRange}
                onValueChange={setPriceRange}
                className="w-full"
              />
            )}
          </div>

          {/* Vendors */}
          {capabilities.vendors !== false && filterData.vendors.length > 0 && (
            <FilterSection
              title={labels.vendors || "Vendor"}
              items={filterData.vendors}
              selected={selectedVendors}
              onToggle={(v) => toggleSelection(selectedVendors, setSelectedVendors, v)}
            />
          )}

          {/* Product Types */}
          {capabilities.categories !== false && filterData.types.length > 0 && (
            <FilterSection
              title={labels.categories || "Category"}
              items={filterData.types}
              selected={selectedTypes}
              onToggle={(v) => toggleSelection(selectedTypes, setSelectedTypes, v)}
            />
          )}

          {/* Options (Size, Color, etc) */}
          {capabilities.variantOptions !== false && filterData.options.map(option => (
            <FilterSection
              key={option.key}
              title={option.name}
              items={option.values}
              selected={selectedOptions[option.key] || []}
              onToggle={(v) => toggleOption(option.key, v)}
            />
          ))}

          {/* Tags */}
          {capabilities.tags !== false && filterData.tags.length > 0 && (
            <FilterSection
              title="Tags"
              items={filterData.tags}
              selected={selectedTags}
              onToggle={(v) => toggleSelection(selectedTags, setSelectedTags, v)}
            />
          )}
        </div>
      </ScrollArea>
      </aside>
    </>
  );
}

function FilterSection({ title, items: collectionItems, selected, onToggle }) {
  // A selection restored from a link can name something this collection doesn't
  // have; list it (last) so it can still be seen and cleared.
  const items = [...collectionItems, ...new Set(selected.filter(item => !collectionItems.includes(item)))];
  const [expanded, setExpanded] = React.useState(items.length <= 8);
  const idPrefix = useId();

  // A collapsed section still shows what is selected, so no active filter is
  // ever hidden behind "Show more".
  const displayItems = expanded ? items : items.filter((item, i) => i < 5 || selected.includes(item));
  const hiddenCount = items.length - displayItems.length;
  const hasMore = expanded ? items.length > 5 : hiddenCount > 0;

  return (
    <div className="space-y-2">
      <div className="flex items-center space-x-2 justify-between">
        <Label className="text-sm font-medium">{title}</Label>
        {hasMore && (
          <><Separator /><Button
            variant="link"
            size="sm"
            onClick={() => setExpanded(!expanded)}
            className="text-sidebar-primary p-0 h-auto"
          >
            {expanded ? "Show less" : `Show ${formatCount(hiddenCount)} more`}
          </Button></>
        )}
      </div>
      <div className="space-y-2">
        {displayItems.map((item, index) => (
          <div key={item} className="flex items-center space-x-2">
            <Checkbox
              id={`${idPrefix}-${index}`}
              checked={selected.includes(item)}
              onCheckedChange={() => onToggle(item)}
            />
            <Label 
              htmlFor={`${idPrefix}-${index}`} 
              className="text-sm font-[350] cursor-pointer flex-1 truncate"
            >
              {item}
            </Label>
          </div>
        ))}
      </div>
    </div>
  );
}