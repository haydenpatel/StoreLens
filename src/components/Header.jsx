import React from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Package, Clock, RefreshCw, ArrowRight, Loader2 } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export default function Header({ 
  storeInput, 
  onStoreInputChange, 
  onStorePaste,
  onLoad, 
  loading,
  urlHistory,
  onSelectHistory,
  collections,
  collectionsStatus,
  collectionsError,
  selectedHandle,
  onSelectHandle,
  onRetryCollections,
}) {
  const getHostFromValue = (value) => {
    try {
      const parsed = value.startsWith("http") ? new URL(value) : new URL(`https://${value}`);
      return parsed.host;
    } catch {
      return value;
    }
  };

  const handleKeyPress = (e) => {
    if (e.key === 'Enter' && !loading) {
      onLoad();
    }
  };

  return (
    <header className="bg-secondary border-b border-border sticky top-0 z-10">
      <div className="px-4 sm:px-6 py-4 flex flex-col gap-3 xl:flex-row xl:items-center xl:gap-3">
        <div className="max-xl:flex max-xl:items-center max-xl:justify-between max-xl:gap-4 xl:contents">
          <div className="flex items-center gap-3 xl:order-1 xl:shrink-0">
            <div className="w-8 h-8 rounded-lg flex items-top justify-center">
              <img src="/StoreLens-icon.svg"></img>
              <Package className="w-5 h-5 text-background" />
            </div>
            <h1 className="text-lg font-semibold text-foreground">StoreLens</h1>
          </div>

          <Button
            variant="outline"
            asChild
            size="sm"
            className="gap-1 shrink-0 xl:order-3 max-sm:!size-9 max-sm:!p-0 max-sm:!gap-0"
          >
            <a
                href="https://storelens.feedbackchimp.space"
                target="_blank"
                rel="noopener noreferrer"
              >
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="size-5">
                <path strokeLinecap="round" strokeLinejoin="round" d="M8.625 9.75a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm0 0H8.25m4.125 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm0 0H12m4.125 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm0 0h-.375m-13.5 3.01c0 1.6 1.123 2.994 2.707 3.227 1.087.16 2.185.283 3.293.369V21l4.184-4.183a1.14 1.14 0 0 1 .778-.332 48.294 48.294 0 0 0 5.83-.498c1.585-.233 2.708-1.626 2.708-3.228V6.741c0-1.602-1.123-2.995-2.707-3.228A48.394 48.394 0 0 0 12 3c-2.392 0-4.744.175-7.043.513C3.373 3.746 2.25 5.14 2.25 6.741v6.018Z" />
              </svg>
              <span className="hidden sm:inline">Feedback</span>
            </a>
          </Button>
        </div>

        <div className="max-xl:flex max-xl:flex-col max-xl:gap-2 sm:max-xl:flex-row sm:max-xl:flex-wrap sm:max-xl:items-center xl:contents">
          {/* Fixed-width gap matching the original desktop layout's spacing before the URL field. */}
          <div className="max-xl:hidden xl:shrink-0 xl:w-[184px] xl:order-2" aria-hidden="true" />
          <div className="flex gap-2 xl:order-2 sm:flex-1">
            <Input
              type="text"
              placeholder="Paste Shopify store or collection URL"
              value={storeInput}
              onChange={(e) => onStoreInputChange(e.target.value)}
              onPaste={(e) => {
                const text = e.clipboardData.getData("text");
                e.preventDefault();
                onStorePaste(text);
              }}
              onKeyPress={handleKeyPress}
              disabled={loading}
              className="flex-1 max-sm:min-w-0 sm:min-w-[16rem]"
            />
            <Button
              variant="outline"
              size="icon"
              onClick={onLoad}
              disabled={loading || !storeInput.trim()}
              title="Load this store"
              className="shrink-0"
            >
              {loading ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <ArrowRight className="w-4 h-4" />
              )}
            </Button>
          </div>

          {/* Grouped so Recent Stores sits to the right of the dropdown on
              mobile's own row, instead of wrapping below it; dissolves at
              sm+ so tablet/desktop keep their independent flex behavior. */}
          <div className="max-sm:flex max-sm:w-full max-sm:gap-2 sm:contents">
            <Select
              value={selectedHandle || undefined}
              onValueChange={onSelectHandle}
              disabled={loading || !storeInput}
            >
              <SelectTrigger className="max-sm:flex-1 sm:w-auto sm:max-xl:min-w-[12rem] xl:min-w-[16rem] xl:order-2" aria-invalid={collectionsStatus === "error"}>
                <SelectValue
                  placeholder={
                    collectionsStatus === "loading"
                      ? "Discovering collections..."
                      : collectionsStatus === "error"
                      ? "Couldn't load collections"
                      : collections?.length === 0
                      ? "No collections found"
                      : "Select a collection"
                  }
                />
              </SelectTrigger>
              <SelectContent align="start">
                {collectionsStatus === "loading" && (
                  <SelectItem value="__loading" disabled>
                    Discovering collections...
                  </SelectItem>
                )}
                {collectionsStatus === "error" && (
                  <SelectItem value="__error" disabled>
                    {collectionsError || "Couldn't load collections for this store"}
                  </SelectItem>
                )}
                {collectionsStatus === "ready" &&
                  collections.map((collection) => (
                    <SelectItem key={collection.handle} value={collection.handle}>
                      {collection.title}
                      {typeof collection.products_count === "number"
                        ? ` (${collection.products_count})`
                        : ""}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>

            <div className="flex gap-2 xl:order-2">
              {collectionsStatus === "error" && (
                <Button
                  variant="outline"
                  size="icon"
                  title="Retry loading collections"
                  onClick={onRetryCollections}
                  disabled={loading}
                  className="shrink-0"
                >
                  <RefreshCw className="w-4 h-4" />
                </Button>
              )}

              {urlHistory.length > 0 && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="outline" disabled={loading} className="shrink-0 max-[700px]:!size-9 max-[700px]:!p-0 max-[700px]:!gap-0" title="Recent Stores">
                      <Clock className="w-4 h-4" />
                      <span className="hidden min-[700px]:inline">Recent Stores</span>
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-80">
                    <DropdownMenuLabel>Recent Stores</DropdownMenuLabel>
                    <DropdownMenuSeparator />
                    {urlHistory.map((url, index) => (
                      <DropdownMenuItem
                        key={index}
                        onClick={() => onSelectHistory(url)}
                        className="cursor-pointer"
                      >
                        <div className="truncate text-sm">{getHostFromValue(url)}</div>
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
            </div>
          </div>

          {/* Absorbs leftover space in the single-row desktop layout, pushing
              Feedback to the far right instead of stretching Input/Select. */}
          <div className="max-xl:hidden xl:flex-1 xl:order-2" aria-hidden="true" />
        </div>
      </div>
    </header>
  );
}
