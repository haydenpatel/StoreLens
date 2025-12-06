import React from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Search, X } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator"
import { getDiscountData } from "@/lib/utils";


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
  onReset
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

  return (
    // <aside className="w-80 bg-secondary border-r border-sidebar-border sticky top-[73px] h-[calc(100vh-73px)]">
    <aside className="w-80 sticky top-[73px] h-[calc(100vh-73px)]">
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
          <div className="flex items-center justify-between">
            <h2 className="font-semibold text-sidebar-primary">Filters</h2>
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