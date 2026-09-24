import React, { useEffect, useRef, useState } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Search, X } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator"
import { cn } from "@/lib/utils";


export default function Sidebar({
  filterData,
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

  const hasActiveFilters = searchQuery || selectedVendors.length > 0 ||
    selectedTypes.length > 0 || selectedTags.length > 0 ||
    Object.values(selectedOptions).some(v => v.length > 0) ||
    !inStockOnly || saleOnly ||
    (priceRange[0] !== filterData.minPrice || priceRange[1] !== filterData.maxPrice);

  // Below xl the sidebar is an off-screen drawer rather than a permanently
  // docked panel, so its controls need to be inert (and focus managed) while
  // closed instead of just visually translated away.
  const [isDesktop, setIsDesktop] = useState(
    () => typeof window !== "undefined" && window.matchMedia("(min-width: 1280px)").matches
  );
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
                className="pl-9 text-sm"
              />
            </div>
          </div>

          {/* Header */}
          <div className="flex items-center justify-between gap-2">
            <h2 className="font-semibold text-sidebar-primary">Filters</h2>
            <div className="flex items-center gap-2">
            {hasActiveFilters && (
              <Button
                variant="default"
                size="sm"
                onClick={onReset}
              >
                <X className="w-3 h-3 mr-1" />
                Reset
              </Button>
            )}
            {!hasActiveFilters && ( /* Filters in default state */
              <Button
                variant="disabled"
                size="sm"
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
              Price Range: <span className="font-[350]">${priceRange[0]} - ${priceRange[1]}</span>
            </Label>
            <Slider
              min={filterData.minPrice}
              max={filterData.maxPrice}
              step={1}
              value={priceRange}
              onValueChange={setPriceRange}
              className="w-full"
            />
          </div>

          {/* Vendors */}
          {filterData.vendors.length > 0 && (
            <FilterSection
              title="Vendor"
              items={filterData.vendors}
              selected={selectedVendors}
              onToggle={(v) => toggleSelection(selectedVendors, setSelectedVendors, v)}
            />
          )}

          {/* Product Types */}
          {filterData.types.length > 0 && (
            <FilterSection
              title="Product Type"
              items={filterData.types}
              selected={selectedTypes}
              onToggle={(v) => toggleSelection(selectedTypes, setSelectedTypes, v)}
            />
          )}

          {/* Options (Size, Color, etc) */}
          {filterData.options.map(option => (
            <FilterSection
              key={option.key}
              title={option.name}
              items={option.values}
              selected={selectedOptions[option.key] || []}
              onToggle={(v) => toggleOption(option.key, v)}
            />
          ))}

          {/* Tags */}
          {filterData.tags.length > 0 && (
            <FilterSection
              title="Tags"
              items={filterData.tags.slice(0, 20)}
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

function FilterSection({ title, items, selected, onToggle }) {
  const [expanded, setExpanded] = React.useState(items.length <= 8);

  const displayItems = expanded ? items : items.slice(0, 5);
  const hasMore = items.length > 5;

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
            {expanded ? "Show less" : `Show ${items.length - 5} more`}
          </Button></>
        )}
      </div>
      <div className="space-y-2">
        {displayItems.map(item => (
          <div key={item} className="flex items-center space-x-2">
            <Checkbox
              id={`${title}-${item}`}
              checked={selected.includes(item)}
              onCheckedChange={() => onToggle(item)}
            />
            <Label 
              htmlFor={`${title}-${item}`} 
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