import React from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Package, Loader2, Clock } from "lucide-react";
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
    {/* <header className="bg-secondary sticky top-0 z-10"> */}
      <div className="px-6 py-4">
        <div className="flex items-center gap-49">
          <div className="flex items-center gap-4">
            <div className="w-8 h-8 rounded-lg flex items-top justify-center">
              <img src="/StoreLens-icon.svg"></img>
              <Package className="w-5 h-5 text-background" />
            </div>
            <h1 className="text-lg font-semibold text-foreground">StoreLens</h1>
          </div>

          <div className="flex-1 flex items-center gap-2">
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
              className="flex-1 min-w-[16rem]"
            />
            <Select
              value={selectedHandle || undefined}
              onValueChange={onSelectHandle}
              disabled={loading || !storeInput}
            >
              <SelectTrigger className="min-w-[16rem]" aria-invalid={collectionsStatus === "error"}>
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
                      {collection.title} ({collection.products_count})
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
            
            {urlHistory.length > 0 && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" disabled={loading}>
                    <Clock className="w-4 h-4" />Recent Stores
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-80">
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

            {/*<Button 
              onClick={onLoad} 
              disabled={loading || !storeInput.trim()}
              // variant="default"
            >
              {loading ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Loading...
                </>
              ) : (
                "Load Collection"
              )}
            </Button>*/}
          </div>
          <div className="flex items-center justify-items-end gap-2">
            <Button
              variant="outline"
              asChild
              className="gap-1"
            >
              <a 
                  href="https://storelens.feedbackchimp.space"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="size-6">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M8.625 9.75a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm0 0H8.25m4.125 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm0 0H12m4.125 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm0 0h-.375m-13.5 3.01c0 1.6 1.123 2.994 2.707 3.227 1.087.16 2.185.283 3.293.369V21l4.184-4.183a1.14 1.14 0 0 1 .778-.332 48.294 48.294 0 0 0 5.83-.498c1.585-.233 2.708-1.626 2.708-3.228V6.741c0-1.602-1.123-2.995-2.707-3.228A48.394 48.394 0 0 0 12 3c-2.392 0-4.744.175-7.043.513C3.373 3.746 2.25 5.14 2.25 6.741v6.018Z" />
                </svg>
                Feedback
              </a>
            </Button>
          </div>
        </div>
      </div>
    </header>
  );
}
